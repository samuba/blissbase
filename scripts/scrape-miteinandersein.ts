/**
 * Scrapes upcoming events from miteinandersein.net.
 * Listing: `/events/` (numeric detail URLs). Fields from detail HTML + Event JSON-LD.
 *
 * Usage:
 *   bun run scripts/scrape-miteinandersein.ts
 *   bun run scripts/scrape-miteinandersein.ts --limit 10
 *   bun run scripts/scrape-miteinandersein.ts --limit=10
 *   bun run scripts/scrape-miteinandersein.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	isTimeoutError,
	makeAbsoluteUrl,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://www.miteinandersein.net`;
const LISTING_URL = `${SITE_BASE}/events/`;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const SOURCE = `miteinandersein` as const;
/** One at a time — small site; avoid hammering detail pages. */
const DETAIL_CONCURRENCY = 1;
/** GHA IPs get 429 after ~40 requests at ~1.2s spacing; stay well under that. */
const DETAIL_DELAY_MS = 3000;
const SOFT_BLOCK_COOLDOWN_MS = 60_000;
const MAX_CONSECUTIVE_SOFT_BLOCKS = 5;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching MiteinanderSein event listing${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);
		let listingHtml: string;
		try {
			listingHtml = await customFetch(LISTING_URL, { returnType: `text` });
		} catch (error) {
			console.error(`Failed to fetch listing:`, error);
			return [];
		}

		const allUrls = extractEventUrls(listingHtml);
		const urls = resolvedLimit ? allUrls.slice(0, resolvedLimit) : allUrls;
		console.error(
			`Found ${allUrls.length} event URLs${resolvedLimit ? `, fetching ${urls.length}` : ``}. Loading detail pages...`,
		);

		let consecutiveSoftBlocks = 0;
		let abortRemaining = false;

		const results = await mapWithConcurrency({
			items: urls,
			concurrency: DETAIL_CONCURRENCY,
			mapper: async (url) => {
				if (abortRemaining) return undefined;

				try {
					const html = await customFetch(url, { returnType: `text` });
					consecutiveSoftBlocks = 0;
					return await this.extractEventData(html, url);
				} catch (error) {
					console.error(`Failed to process ${url}:`, error);
					if (!isSoftBlockError(error)) return undefined;

					consecutiveSoftBlocks += 1;
					const pauseMs = Math.min(SOFT_BLOCK_COOLDOWN_MS * consecutiveSoftBlocks, 180_000);
					console.error(
						`Soft-blocked (${consecutiveSoftBlocks}x). Cooling down ${pauseMs}ms before continuing...`,
					);
					await sleep(pauseMs);

					if (consecutiveSoftBlocks >= MAX_CONSECUTIVE_SOFT_BLOCKS) {
						console.error(
							`Stopping detail fetches after ${consecutiveSoftBlocks} consecutive soft blocks.`,
						);
						abortRemaining = true;
					}
					return undefined;
				}
			},
		});

		const events: ScrapedEvent[] = [];
		for (const event of results) {
			if (!event) continue;
			events.push(event);
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const url = inferFileUrl(filePath);
				const event = await this.extractEventData(html, url);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapMiteinanderseinEvent({ html, url });
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName(html);
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt(html);
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt(html);
	}
	extractAddress(html: string): string[] | undefined {
		return getAddress(html);
	}
	extractPrice(html: string): string | undefined {
		return getPrice(html);
	}
	extractDescription(html: string): string | undefined {
		return getDescription(html);
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls(html);
	}
	extractHost(html: string): string | undefined {
		return getHost(html);
	}
	extractHostLink(html: string): string | undefined {
		return getHostLink(html);
	}
	extractTags(html: string): string[] | undefined {
		return getTags(html);
	}
}

export async function mapMiteinanderseinEvent(args: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const { html, url } = args;
	const name = getName(html);
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl({ html, url });
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	if (!isUpcoming({ startAt, endAt: getEndAt(html) })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	const address = getAddress(html);
	let latitude: number | null = null;
	let longitude: number | null = null;
	let timezone: string | null = DEFAULT_TIMEZONE;

	if (address?.length && !isOnlineAddress(address)) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			latitude = geocoded?.lat ?? null;
			longitude = geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${sourceUrl}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt: getEndAt(html),
		timezone,
		address,
		price: getPrice(html),
		priceIsHtml: false,
		description: getDescription(html),
		imageUrls: getImageUrls(html),
		host: getHost(html),
		hostLink: getHostLink(html),
		contact: getContact(html),
		latitude,
		longitude,
		tags: getTags(html),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export function extractEventUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls = new Set<string>();

	$(`a[href]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		if (!href) return;
		const match = href.match(/\/events\/(\d+)\/?$/);
		if (!match) return;
		urls.add(`${SITE_BASE}/events/${match[1]}/`);
	});

	return [...urls];
}

export function getName(html: string): string | undefined {
	const $ = cheerio.load(html);
	const h1 = superTrim($(`h1#main-heading`).text()) || superTrim($(`h1`).first().text());
	if (h1) return h1;

	const ldName = readEvent(html)?.name;
	return superTrim(typeof ldName === `string` ? ldName : undefined) || undefined;
}

export function getStartAt(html: string): string | undefined {
	return parseEventDate(readEvent(html)?.startDate) ?? parseTimeElementStart(html);
}

export function getEndAt(html: string): string | undefined {
	const startAt = getStartAt(html);
	const endAt = parseEventDate(readEvent(html)?.endDate) ?? parseTimeElementEnd(html);
	if (!endAt) return undefined;
	if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
}

export function getAddress(html: string): string[] {
	if (isOnlineEvent(html)) return [`Online`];

	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	const $ = cheerio.load(html);
	const addressHtml = $(`address[aria-label="Adresse der Veranstaltung"]`).first().html();
	if (addressHtml) {
		for (const part of addressHtml.split(/<br\s*\/?>/i)) {
			push(part.replace(/<[^>]+>/g, ``));
		}
	}

	// Prefer the visible address block when present; JSON-LD often duplicates it differently.
	if (!lines?.length) {
		const location = readEvent(html)?.location;
		if (location && typeof location === `object` && location[`@type`] !== `VirtualLocation`) {
			push(typeof location.name === `string` ? location.name : undefined);
			const address = location.address;
			if (typeof address === `string`) {
				push(address);
			} else if (address && typeof address === `object`) {
				push(typeof address.streetAddress === `string` ? address.streetAddress : undefined);
				push(
					[address.postalCode, address.addressLocality]
						.filter((part): part is string => typeof part === `string` && Boolean(part.trim()))
						.join(` `),
				);
				const country = typeof address.addressCountry === `string` ? address.addressCountry.trim() : ``;
				if (country && country !== `DE` && lines?.length) push(country);
			}
		}
	}

	// Country-only / placeholder venues are not useful addresses.
	if (lines.length === 1 && /^(de|at|ch|np|[a-z]{2})$/i.test(lines[0])) return [];
	if (lines.length === 1 && /wo immer du bist/i.test(lines[0])) return [];

	return lines;
}

export function getPrice(html: string): string | undefined {
	const $ = cheerio.load(html);
	const priceBlock = $(`i.bi-cash`).first().closest(`.col-1`).next(`.col-11`);
	const fromHtml = superTrim(priceBlock.text()?.replace(/\s+/g, ` `));
	if (fromHtml && !/auf anfrage/i.test(fromHtml)) {
		return fromHtml.replace(/\s*€\s*$/, `€`).replace(/&euro;/gi, `€`);
	}

	const offers = readEvent(html)?.offers;
	const offer = Array.isArray(offers) ? offers[0] : offers;
	if (!offer || typeof offer !== `object`) {
		if (fromHtml && /auf anfrage/i.test(fromHtml)) return `Preis auf Anfrage`;
		return undefined;
	}

	const spec = offer.priceSpecification;
	if (spec && typeof spec === `object`) {
		const min = toNumber(spec.minPrice ?? spec.price);
		const max = toNumber(spec.maxPrice);
		if (min != null && max != null && min !== max) {
			return `${formatAmount(min)} – ${formatAmount(max)}€`;
		}
		if (min != null) return formatEuro(min);
	}

	const amount = toNumber(offer.price);
	if (amount != null) return formatEuro(amount);

	const name = superTrim(typeof offer.name === `string` ? offer.name : undefined);
	if (name && /anfrage/i.test(name)) return `Preis auf Anfrage`;
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const heading = $(`h4`).filter((_i, el) => superTrim($(el).text()) === `Beschreibung`).first();
	if (heading.length) {
		const parts: string[] = [];
		let node = heading.next();
		while (node.length) {
			const tag = node.prop(`tagName`)?.toLowerCase();
			// CTA nav + site chrome after the prose; tags live in their own trailing paragraph.
			if (tag === `h4` || tag === `h3` || tag === `section` || tag === `nav`) break;
			if (isTagOnlyBlock(node)) {
				node = node.next();
				continue;
			}
			const outer = $.html(node);
			if (outer?.trim()) parts.push(outer);
			node = node.next();
		}
		if (parts?.length) {
			const cleaned = cleanProseHtml(parts.join(``));
			if (cleaned?.trim()) return cleaned;
		}
	}

	const text = superTrim(typeof readEvent(html)?.description === `string` ? readEvent(html)?.description : undefined);
	if (!text) return undefined;
	const htmlFromText = text
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join(``);
	return cleanProseHtml(htmlFromText) || undefined;
}

function isTagOnlyBlock(node: cheerio.Cheerio<any>): boolean {
	const clone = node.clone();
	clone.find(`a[href*="/events/tag/"]`).remove();
	const leftover = superTrim(clone.text());
	if (leftover) return false;
	return node.find(`a[href*="/events/tag/"]`).length > 0;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const absolute = makeAbsoluteUrl(raw, SITE_BASE);
		if (!absolute) return;
		if (/logo|og_img|favicon|apple-touch/i.test(absolute)) return;
		if (!/uploads\/veranstaltungen\//i.test(absolute)) return;
		const key = absolute.split(`?`)[0];
		if (seen.has(key)) return;
		seen.add(key);
		urls.push(absolute);
	};

	const image = readEvent(html)?.image;
	if (Array.isArray(image)) {
		for (const item of image) {
			if (typeof item === `string`) add(item);
		}
	} else if (typeof image === `string`) {
		add(image);
	}

	const $ = cheerio.load(html);
	$(`img.event-img, img[src*="/uploads/veranstaltungen/"]`).each((_i, el) => {
		add($(el).attr(`src`));
	});

	return urls;
}

export function getHost(html: string): string | undefined {
	const organizer = readEvent(html)?.organizer;
	if (organizer && typeof organizer === `object`) {
		const name = superTrim(typeof organizer.name === `string` ? organizer.name : undefined);
		if (name) return name;
	}

	const $ = cheerio.load(html);
	const link = $(`a[href^="/events/"]`).filter((_i, el) => {
		const href = $(el).attr(`href`) || ``;
		return /^\/events\/[a-z][\w-]*\/?$/i.test(href);
	}).first();
	return superTrim(link.text()) || undefined;
}

export function getHostLink(html: string): string | undefined {
	const $ = cheerio.load(html);
	const href = $(`a[href^="/events/"]`).filter((_i, el) => {
		const value = $(el).attr(`href`) || ``;
		return /^\/events\/[a-z][\w-]*\/?$/i.test(value);
	}).first().attr(`href`);
	return makeAbsoluteUrl(href, SITE_BASE);
}

export function getTags(html: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const tag = superTrim(raw)?.replace(/^#+/, ``);
		if (!tag || tag.length > 40) return;
		const key = tag.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(tag);
	};

	const keywords = readEvent(html)?.keywords;
	if (Array.isArray(keywords)) {
		for (const keyword of keywords) {
			if (typeof keyword === `string`) add(keyword);
		}
	} else if (typeof keywords === `string`) {
		for (const part of keywords.split(/[,;]/)) add(part);
	}

	const $ = cheerio.load(html);
	$(`a[href^="/events/tag/"]`).each((_i, el) => add($(el).text()));
	if (isOnlineEvent(html)) add(`Online`);

	return tags;
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const value = superTrim(raw);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	const $ = cheerio.load(html);
	$(`a`).filter((_i, el) => /offizielle seite/i.test($(el).text())).each((_i, el) => {
		const href = $(el).attr(`href`);
		if (!href) return;
		try {
			const url = new URL(href, SITE_BASE);
			url.searchParams.delete(`utm_source`);
			push(url.toString());
		} catch {
			/* ignore */
		}
	});

	const ld = readEvent(html);
	if (typeof ld?.url === `string` && !ld.url.includes(`miteinandersein.net`)) {
		push(ld.url);
	}

	const offers = ld?.offers;
	const offer = Array.isArray(offers) ? offers[0] : offers;
	if (offer && typeof offer === `object`) {
		if (typeof offer.url === `string`) push(offer.url);
		const seller = offer.seller;
		if (seller && typeof seller === `object`) {
			if (typeof seller.email === `string`) push(seller.email);
			if (typeof seller.telephone === `string`) push(seller.telephone);
			if (typeof seller.url === `string`) push(seller.url);
		}
	}

	const organizer = ld?.organizer;
	if (organizer && typeof organizer === `object`) {
		if (typeof organizer.email === `string`) push(organizer.email);
		if (typeof organizer.telephone === `string`) push(organizer.telephone);
		if (typeof organizer.url === `string`) push(organizer.url);
	}

	return contacts;
}

function getSourceUrl(args: { html: string; url: string }): string | undefined {
	const { html, url } = args;
	const $ = cheerio.load(html);
	const canonical = $(`link[rel="canonical"]`).attr(`href`);
	const fromCanonical = normalizeEventUrl(canonical);
	if (fromCanonical) return fromCanonical;

	const og = $(`meta[property="og:url"]`).attr(`content`);
	const fromOg = normalizeEventUrl(og);
	if (fromOg) return fromOg;

	return normalizeEventUrl(url) || url;
}

function normalizeEventUrl(raw: string | undefined): string | undefined {
	if (!raw?.trim()) return undefined;
	try {
		const url = new URL(raw, SITE_BASE);
		const match = url.pathname.match(/\/events\/(\d+)\/?$/);
		if (!match) return undefined;
		return `${SITE_BASE}/events/${match[1]}/`;
	} catch {
		return undefined;
	}
}

function readEvent(html: string): LdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).html() || $(el).text();
		if (!text?.includes(`Event`)) continue;
		try {
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as unknown;
			const nodes = ldNodes(parsed);
			const event = nodes.find((node) => node?.[`@type`] === `Event`);
			if (event) return event;
		} catch (error) {
			console.error(`Event JSON-LD is not valid JSON:`, error);
		}
	}
	return undefined;
}

function ldNodes(parsed: unknown): LdEvent[] {
	if (Array.isArray(parsed)) return parsed as LdEvent[];
	if (!parsed || typeof parsed !== `object`) return [];
	const graph = (parsed as Record<string, unknown>)[`@graph`];
	if (Array.isArray(graph)) return graph as LdEvent[];
	return [parsed as LdEvent];
}

function parseEventDate(value: unknown): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const raw = value.trim();

	const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnly) {
		return dateToIsoStr(
			Number(dateOnly[1]),
			Number(dateOnly[2]),
			Number(dateOnly[3]),
			0,
			0,
			DEFAULT_TIMEZONE,
			false,
		);
	}

	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return undefined;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;

	// Keep source offset when present; otherwise normalize via Berlin wall clock.
	if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return raw;
	return dateToIsoStr(
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		DEFAULT_TIMEZONE,
		false,
	);
}

function parseTimeElementStart(html: string): string | undefined {
	const $ = cheerio.load(html);
	const datetime = $(`time[datetime]`).first().attr(`datetime`);
	if (!datetime) return undefined;
	const start = datetime.split(`/`)[0];
	return parseEventDate(start);
}

function parseTimeElementEnd(html: string): string | undefined {
	const $ = cheerio.load(html);
	const datetime = $(`time[datetime]`).first().attr(`datetime`);
	if (!datetime?.includes(`/`)) return undefined;
	const end = datetime.split(`/`)[1];
	return parseEventDate(end);
}

function isOnlineEvent(html: string): boolean {
	const ld = readEvent(html);
	if (typeof ld?.eventAttendanceMode === `string` && /Online/i.test(ld.eventAttendanceMode)) {
		return true;
	}
	if (ld?.location && typeof ld.location === `object` && ld.location[`@type`] === `VirtualLocation`) {
		return true;
	}
	const $ = cheerio.load(html);
	return $(`.badge`).toArray().some((el) => /^online$/i.test(superTrim($(el).text()) || ``));
}

function isOnlineAddress(address: string[]): boolean {
	return address.length === 1 && /^online$/i.test(address[0]);
}

function isUpcoming(args: { startAt: string; endAt?: string | null }): boolean {
	const { startAt, endAt } = args;
	const endMs = new Date(endAt || startAt).getTime();
	if (Number.isNaN(endMs)) return false;
	// Keep same-day / still-running events even if start was earlier today.
	return endMs >= Date.now() - 12 * 60 * 60 * 1000;
}

function toNumber(value: unknown): number | null {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value !== `string`) return null;
	const normalized = value.trim().replace(`,`, `.`);
	const amount = Number(normalized);
	return Number.isFinite(amount) ? amount : null;
}

function formatAmount(amount: number): string {
	return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(`.`, `,`);
}

function formatEuro(amount: number): string {
	return `${formatAmount(amount)}€`;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function inferFileUrl(filePath: string): string {
	const match = filePath.match(/(\d+)/);
	if (match) return `${SITE_BASE}/events/${match[1]}/`;
	return filePath;
}

function isSoftBlockError(error: unknown): boolean {
	if (isTimeoutError(error)) return true;
	return error instanceof Error && error.message.includes(`429`);
}

async function mapWithConcurrency<T, R>(args: {
	items: T[];
	concurrency: number;
	mapper: (item: T) => Promise<R>;
}): Promise<R[]> {
	const { items, concurrency, mapper } = args;
	if (!items?.length) return [];

	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
			if (nextIndex < items.length) await sleep(DETAIL_DELAY_MS);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg === `-n`) {
			limit = parseLimitValue(argv[++i]);
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			limit = parseLimitValue(arg.slice(`--limit=`.length));
			continue;
		}
		// Ignore runner flags (`--clean`, `--dry-run`, …) and other unknowns.
		if (arg.startsWith(`-`)) {
			if (arg === `--log-dir` || arg === `--exclude`) i++;
			continue;
		}
		files.push(arg);
	}

	return { limit, files };
}

function parseLimitValue(raw: string | undefined): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit value: ${raw}`);
	return Math.floor(parsed);
}

if (import.meta.main) {
	try {
		const { limit, files } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length
			? await scraper.scrapeHtmlFiles(limit ? files.slice(0, limit) : files)
			: await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
		console.error(`Collected ${events.length} events.`);
		process.exit(0);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type LdPostalAddress = {
	[`@type`]?: string;
	streetAddress?: string;
	addressLocality?: string;
	postalCode?: string;
	addressCountry?: string;
};

type LdLocation = {
	[`@type`]?: string;
	name?: string;
	description?: string;
	address?: string | LdPostalAddress;
};

type LdOffer = {
	name?: string;
	price?: string | number;
	priceCurrency?: string;
	url?: string;
	priceSpecification?: {
		[`@type`]?: string;
		price?: string | number;
		minPrice?: string | number;
		maxPrice?: string | number;
		priceCurrency?: string;
	};
	seller?: {
		name?: string;
		email?: string;
		telephone?: string;
		url?: string;
	};
};

type LdEvent = {
	[`@type`]?: string;
	name?: string;
	startDate?: string;
	endDate?: string;
	description?: string;
	url?: string;
	image?: string | string[];
	keywords?: string | string[];
	eventAttendanceMode?: string;
	location?: LdLocation;
	offers?: LdOffer | LdOffer[];
	organizer?: {
		name?: string;
		email?: string;
		telephone?: string;
		url?: string;
	};
};
