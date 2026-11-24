/**
 * Scrapes cooleventasia.com via sitemap.xml (`/event/{slug}`), then each
 * detail page. Structured fields come from schema.org Event JSON-LD; tags,
 * gallery images, and rich description come from HTML.
 *
 * Usage:
 *   bun run scripts/scrape-cooleventasia.ts
 *   bun run scripts/scrape-cooleventasia.ts --limit 10
 *   bun run scripts/scrape-cooleventasia.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	REQUEST_DELAY_MS,
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	makeAbsoluteUrl,
	sleep,
	superTrim,
} from './common.ts';

const SITE_BASE = `https://cooleventasia.com`;
const SITEMAP_URL = `${SITE_BASE}/sitemap.xml`;
const SOURCE = `cooleventasia` as const;
const DEFAULT_TIMEZONE = `Asia/Makassar` as const;
const RUNNER_FLAGS = new Set([
	`--clean`,
	`--dry-run`,
	`--write-baseline`,
	`--exclude`,
	`--log-dir`,
]);

export class WebsiteScraper implements WebsiteScraperInterface {
	private readonly requestDelayMs = REQUEST_DELAY_MS;

	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Cool Event Asia sitemap${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let urls: string[];
		try {
			urls = await fetchEventUrlsFromSitemap();
		} catch (error) {
			console.error(`Failed to fetch sitemap:`, error);
			return [];
		}

		const toFetch = resolvedLimit ? urls.slice(0, resolvedLimit) : urls;
		console.error(
			`Found ${urls.length} event URLs${resolvedLimit ? `, fetching ${toFetch.length}` : ``}. Loading detail pages...`,
		);

		const events: ScrapedEvent[] = [];
		for (const url of toFetch) {
			try {
				await sleep(this.requestDelayMs);
				const html = await customFetch(url, { returnType: `text` });
				if (!html) {
					console.error(`Empty response for ${url}`);
					continue;
				}
				const event = await mapCoolEventAsiaEvent({ html, url });
				if (event) events.push(event);
			} catch (error) {
				console.error(`Failed to process ${url}:`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const event = await mapCoolEventAsiaEvent({
					html,
					url: inferFileUrl(filePath),
				});
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapCoolEventAsiaEvent({ html, url });
		} catch (error) {
			console.error(`Error extracting event data for ${url}:`, error);
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

export async function mapCoolEventAsiaEvent(args: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const { html, url } = args;
	const name = getName(html);
	const startAt = getStartAt(html);
	if (!name || !startAt) {
		console.error(`Skipping ${url} due to missing name or start date.`);
		return undefined;
	}

	if (isCancelled(html)) {
		console.error(`Skipping cancelled event ${url}`);
		return undefined;
	}

	const endAt = getEndAt(html);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${url}`);
		return undefined;
	}

	const address = getAddress(html);
	let latitude: number | null = null;
	let longitude: number | null = null;
	let timezone: string | null = getTimezone(html) ?? DEFAULT_TIMEZONE;

	const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY || ``;
	if (mapsApiKey && address?.length && !isOnlineAddress(address)) {
		try {
			const { geocodeAddressCached } = await import(`../src/lib/server/google.script.ts`);
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey: mapsApiKey,
			});
			latitude = geocoded?.lat ?? null;
			longitude = geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${url}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt,
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
		sourceUrl: getSourceUrl({ html, url }),
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export async function fetchEventUrlsFromSitemap(): Promise<string[]> {
	const xml = await customFetch(SITEMAP_URL, { returnType: `text` });
	return extractEventUrlsFromSitemap(xml);
}

export function extractEventUrlsFromSitemap(xml: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const matches = xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
	for (const match of matches) {
		const raw = decodeXml(match[1]?.trim() ?? ``);
		if (!raw) continue;
		let parsed: URL;
		try {
			parsed = new URL(raw);
		} catch {
			continue;
		}
		if (parsed.hostname !== `cooleventasia.com` && parsed.hostname !== `www.cooleventasia.com`) {
			continue;
		}
		const pathMatch = parsed.pathname.match(/^\/event\/([^/]+)\/?$/);
		if (!pathMatch) continue;
		const slug = pathMatch[1];
		if (!slug || slug === `region` || slug === `tag`) continue;
		const canonical = `${SITE_BASE}/event/${slug}`;
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		urls.push(canonical);
	}
	return urls;
}

export function getName(html: string): string | undefined {
	const $ = cheerio.load(html);
	const h1 = superTrim($(`article.event-detail h1`).first().text()) || superTrim($(`h1`).first().text());
	if (h1) return h1;

	return textValue(readEvent(html)?.name);
}

export function getStartAt(html: string): string | undefined {
	const fromLd = parseLdDate({ value: readEvent(html)?.startDate, role: `start` });
	if (fromLd && !isDateOnlyIso(readEvent(html)?.startDate)) return fromLd;

	const fromLabel = parseWhenLabel(html)?.startAt;
	if (fromLabel) return fromLabel;
	return fromLd;
}

export function getEndAt(html: string): string | undefined {
	const startAt = getStartAt(html);
	const ldEnd = readEvent(html)?.endDate;
	const fromLd = parseLdDate({ value: ldEnd, role: `end` });
	const fromLabel = isDateOnlyIso(ldEnd) ? parseWhenLabel(html)?.endAt : undefined;
	const endAt = fromLabel || fromLd;
	if (!endAt) return undefined;
	if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
}

export function getTimezone(html: string): string | undefined {
	const startAt = getStartAt(html);
	if (!startAt) return undefined;
	if (/[+-]08:00$/.test(startAt)) return DEFAULT_TIMEZONE;
	return undefined;
}

export function getAddress(html: string): string[] {
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

	if (isOnlineEvent(html)) {
		push(`Online`);
		return lines;
	}

	const location = readEvent(html)?.location;
	if (location && typeof location === `object` && location[`@type`] !== `VirtualLocation`) {
		push(typeof location.name === `string` ? location.name : undefined);
		const address = location.address;
		if (typeof address === `string`) {
			for (const part of address.split(`,`)) push(part);
		} else if (address && typeof address === `object`) {
			push(typeof address.streetAddress === `string` ? address.streetAddress : undefined);
			const locality = [
				typeof address.postalCode === `string` ? address.postalCode : undefined,
				typeof address.addressLocality === `string` ? address.addressLocality : undefined,
			]
				.filter(Boolean)
				.join(` `);
			if (locality) push(locality);
			push(typeof address.addressRegion === `string` ? address.addressRegion : undefined);
			push(typeof address.addressCountry === `string` ? address.addressCountry : undefined);
		}
	}

	if (!lines?.length) {
		const $ = cheerio.load(html);
		const locationLabel = $(`.event-info-label`)
			.filter((_i, el) => /location/i.test($(el).text()))
			.first();
		push(superTrim(locationLabel.next(`.event-info-value`).text()));
	}

	return lines;
}

export function getPrice(html: string): string | undefined {
	const offers = offerList(readEvent(html)?.offers);
	const labels: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const label = superTrim(raw);
		if (!label) return;
		const key = label.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		labels.push(label);
	};

	for (const offer of offers) {
		if (typeof offer.description === `string`) {
			push(normalizePriceLabel(offer.description));
			continue;
		}
		push(formatOfferPrice(offer));
	}

	if (!labels?.length) {
		const $ = cheerio.load(html);
		$(`.ticket-price`).each((_i, el) => {
			push(normalizePriceLabel($(el).text()));
		});
	}

	if (!labels?.length) return undefined;
	if (labels.length === 1) return labels[0];
	return labels.join(` / `);
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const rich = $(`.rich-text`).first();
	if (rich.length) {
		const cleaned = cleanProseHtml(rich.html() || ``);
		if (cleaned?.trim()) return cleaned;
	}

	const lede = superTrim($(`p.event-lede`).first().text());
	if (lede) return cleanProseHtml(`<p>${escapeHtml(lede)}</p>`) || undefined;

	const ldDescription = textValue(readEvent(html)?.description);
	if (!ldDescription) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(ldDescription)}</p>`) || undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const add = (raw: unknown) => {
		if (typeof raw !== `string` || !raw.trim()) return;
		const decoded = decodeHtmlEntities(raw.trim());
		const absolute = makeAbsoluteUrl(decoded, SITE_BASE);
		if (!absolute) return;
		if (/\/img\/(logo|favicon|og-default|apple-touch)/i.test(absolute)) return;
		const key = absolute.split(`?`)[0]?.toLowerCase();
		if (!key || seen.has(key)) return;
		seen.add(key);
		urls.push(absolute);
	};

	const image = readEvent(html)?.image;
	if (Array.isArray(image)) {
		for (const item of image) add(item);
	} else {
		add(image);
	}

	const $ = cheerio.load(html);
	add($(`meta[property="og:image"]`).attr(`content`));

	$(`[data-lightbox-full]`).each((_i, el) => {
		add($(el).attr(`data-lightbox-full`));
	});

	return urls;
}

export function getHost(html: string): string | undefined {
	const organizer = readEvent(html)?.organizer;
	if (organizer && typeof organizer === `object`) {
		const name = textValue(organizer.name);
		if (name) return name;
	}

	const performer = readEvent(html)?.performer;
	if (performer && typeof performer === `object`) {
		const name = textValue(performer.name);
		if (name) return name;
	}

	const $ = cheerio.load(html);
	const href = $(`a[href*="/organizer/"]`).first();
	return superTrim(href.text()) || undefined;
}

export function getHostLink(html: string): string | undefined {
	const organizer = readEvent(html)?.organizer;
	if (organizer && typeof organizer === `object` && typeof organizer.url === `string`) {
		const absolute = makeAbsoluteUrl(organizer.url, SITE_BASE);
		if (absolute) return absolute;
	}

	const $ = cheerio.load(html);
	const href = $(`a[href*="/organizer/"]`).first().attr(`href`);
	return makeAbsoluteUrl(href, SITE_BASE);
}

export function getTags(html: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const cleaned = superTrim(raw?.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, ``));
		if (!cleaned || cleaned.length > 40) return;
		if (/^\d+\+$/.test(cleaned)) return;
		const key = cleaned.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(cleaned);
	};

	const $ = cheerio.load(html);
	$(`a[href*="/event/tag/"]`).each((_i, el) => {
		add($(el).text());
	});

	return tags;
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const value = superTrim(raw);
		if (!value) return;
		if (/cooleventasia\.com/i.test(value)) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	for (const offer of offerList(readEvent(html)?.offers)) {
		if (typeof offer.url === `string`) push(offer.url);
	}

	const $ = cheerio.load(html);
	$(`a.ticket-row-cta[href]`).each((_i, el) => {
		push($(el).attr(`href`));
	});
	$(`p.source-note a[href]`).each((_i, el) => {
		push($(el).attr(`href`));
	});

	return contacts;
}

export function getSourceUrl(args: { html: string; url: string }): string {
	const { html, url } = args;
	const ldUrl = readEvent(html)?.url;
	if (typeof ldUrl === `string` && ldUrl.includes(`/event/`)) {
		try {
			const parsed = new URL(ldUrl);
			const match = parsed.pathname.match(/^\/event\/([^/]+)\/?$/);
			if (match?.[1]) return `${SITE_BASE}/event/${match[1]}`;
		} catch {
			/* fall through */
		}
	}

	try {
		const parsed = new URL(url, SITE_BASE);
		const match = parsed.pathname.match(/^\/event\/([^/]+)\/?$/);
		if (match?.[1]) return `${SITE_BASE}/event/${match[1]}`;
	} catch {
		/* fall through */
	}

	return url;
}

function isCancelled(html: string): boolean {
	const status = readEvent(html)?.eventStatus;
	if (typeof status !== `string`) return false;
	return /EventCancelled/i.test(status);
}

function isOnlineEvent(html: string): boolean {
	const mode = readEvent(html)?.eventAttendanceMode;
	if (typeof mode === `string` && /OnlineEventAttendanceMode/i.test(mode)) return true;
	const location = readEvent(html)?.location;
	return !!(location && typeof location === `object` && location[`@type`] === `VirtualLocation`);
}

function isOnlineAddress(address: string[]): boolean {
	return address.some((line) => /^online$/i.test(line.trim()));
}

function isUpcoming(args: { startAt: string; endAt?: string | null }): boolean {
	const { startAt, endAt } = args;
	const endMs = endAt ? new Date(endAt).getTime() : NaN;
	const startMs = new Date(startAt).getTime();
	const anchor = Number.isFinite(endMs) ? endMs : startMs;
	return anchor >= Date.now() - 12 * 60 * 60 * 1000;
}

function readEvent(html: string): LdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).html() || $(el).text();
		if (!text?.includes(`Event`)) continue;
		try {
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as unknown;
			const event = ldNodes(parsed).find((node) => {
				const type = node?.[`@type`];
				if (type === `Event`) return true;
				return Array.isArray(type) && type.includes(`Event`);
			});
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

function offerList(offers: LdOffer | LdOffer[] | undefined): LdOffer[] {
	if (!offers) return [];
	return Array.isArray(offers) ? offers : [offers];
}

function parseLdDate(args: {
	value: unknown;
	role: `start` | `end`;
}): string | undefined {
	const { value, role } = args;
	if (typeof value !== `string` || !value.trim()) return undefined;
	const raw = value.trim();

	// Some listings only publish a calendar day (no time).
	if (isDateOnlyIso(raw)) {
		const time = role === `end` ? `23:59:00` : `00:00:00`;
		const iso = `${raw}T${time}+08:00`;
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return undefined;
		return iso;
	}

	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return undefined;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;
	return raw;
}

function isDateOnlyIso(value: unknown): boolean {
	return typeof value === `string` && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** Parses `.event-info-value` labels like `9 - 29 Nov 2026 08:00 WITA`. */
function parseWhenLabel(html: string): { startAt?: string; endAt?: string } | undefined {
	const $ = cheerio.load(html);
	const label = $(`.event-info-label`)
		.filter((_i, el) => /when/i.test($(el).text()))
		.first();
	const text = superTrim(label.next(`.event-info-value`).text());
	if (!text) return undefined;

	const range = text.match(
		/^(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/,
	);
	if (range) {
		const month = monthIndex(range[3]);
		if (month == null) return undefined;
		const year = Number(range[4]);
		const hour = Number(range[5]);
		const minute = Number(range[6]);
		const startDay = Number(range[1]);
		const endDay = Number(range[2]);
		return {
			startAt: toBaliIso({ year, month, day: startDay, hour, minute }),
			endAt: toBaliIso({ year, month, day: endDay, hour: 23, minute: 59 }),
		};
	}

	const single = text.match(
		/^[A-Za-z]{3},\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/,
	);
	if (!single) return undefined;
	const month = monthIndex(single[2]);
	if (month == null) return undefined;
	return {
		startAt: toBaliIso({
			year: Number(single[3]),
			month,
			day: Number(single[1]),
			hour: Number(single[4]),
			minute: Number(single[5]),
		}),
	};
}

function monthIndex(raw: string): number | undefined {
	const key = raw.slice(0, 3).toLowerCase();
	const months = [
		`jan`,
		`feb`,
		`mar`,
		`apr`,
		`may`,
		`jun`,
		`jul`,
		`aug`,
		`sep`,
		`oct`,
		`nov`,
		`dec`,
	];
	const index = months.indexOf(key);
	return index >= 0 ? index + 1 : undefined;
}

function toBaliIso(args: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}): string | undefined {
	const { year, month, day, hour, minute } = args;
	if (
		!Number.isFinite(year) ||
		!Number.isFinite(month) ||
		!Number.isFinite(day) ||
		!Number.isFinite(hour) ||
		!Number.isFinite(minute)
	) {
		return undefined;
	}
	const iso = `${String(year).padStart(4, `0`)}-${String(month).padStart(2, `0`)}-${String(day).padStart(2, `0`)}T${String(hour).padStart(2, `0`)}:${String(minute).padStart(2, `0`)}:00+08:00`;
	if (Number.isNaN(new Date(iso).getTime())) return undefined;
	return iso;
}

function textValue(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	return superTrim(value) || undefined;
}

function formatOfferPrice(offer: LdOffer): string | undefined {
	const amount = typeof offer.price === `number` ? offer.price : Number(offer.price);
	const currency = typeof offer.priceCurrency === `string` ? offer.priceCurrency.trim() : ``;
	if (!Number.isFinite(amount)) return undefined;
	if (amount === 0) return `Free`;
	if (!currency) return String(amount);
	try {
		return new Intl.NumberFormat(`en`, {
			style: `currency`,
			currency,
			maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
		}).format(amount);
	} catch {
		return `${currency} ${amount}`;
	}
}

function normalizePriceLabel(raw: string): string | undefined {
	const label = superTrim(raw);
	if (!label) return undefined;
	if (/^free(\s+entry)?$/i.test(label)) return `Free`;
	return label;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replaceAll(`&amp;`, `&`)
		.replaceAll(`&quot;`, `"`)
		.replaceAll(`&#39;`, `'`)
		.replaceAll(`&lt;`, `<`)
		.replaceAll(`&gt;`, `>`);
}

function decodeXml(value: string): string {
	return value
		.replaceAll(`&amp;`, `&`)
		.replaceAll(`&lt;`, `<`)
		.replaceAll(`&gt;`, `>`)
		.replaceAll(`&quot;`, `"`)
		.replaceAll(`&apos;`, `'`);
}

function escapeHtml(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function inferFileUrl(filePath: string): string {
	const match = filePath.match(/([a-z0-9-]+(?:-bali-\d{4})?)/i);
	if (match) return `${SITE_BASE}/event/${match[1]}`;
	return filePath;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files?: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg.startsWith(`--limit=`)) {
			const raw = arg === `--limit` ? argv[++i] : arg.slice(`--limit=`.length);
			limit = parseLimitValue(raw);
			continue;
		}
		if (RUNNER_FLAGS.has(arg)) {
			if (arg === `--exclude` || arg === `--log-dir`) i++;
			continue;
		}
		if (arg.startsWith(`-`)) continue;
		files.push(arg);
	}

	return { limit, files: files?.length ? files : undefined };
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
	addressRegion?: string;
	postalCode?: string;
	addressCountry?: string;
};

type LdLocation = {
	[`@type`]?: string;
	name?: string;
	address?: string | LdPostalAddress;
};

type LdOffer = {
	[`@type`]?: string;
	price?: string | number;
	priceCurrency?: string;
	description?: string;
	url?: string;
};

type LdEvent = {
	[`@type`]?: string | string[];
	name?: string;
	startDate?: string;
	endDate?: string;
	description?: string;
	url?: string;
	image?: string | string[];
	eventAttendanceMode?: string;
	eventStatus?: string;
	location?: LdLocation;
	offers?: LdOffer | LdOffer[];
	organizer?: {
		name?: string;
		url?: string;
	};
	performer?: {
		name?: string;
		url?: string;
	};
};
