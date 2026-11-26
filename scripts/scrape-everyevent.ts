/**
 * Scrapes Bali events from BrightStar (EveryEvent Bali).
 *
 * `everyevent.com` is parked; `everyeventbali.com` 307s to BrightStar.
 * Discovery: `/en/discover/location/bali` cards + sitemap shards filtered
 * for Bali-ish `/en/events/...` URLs. Detail fields come from Event JSON-LD
 * plus genre tags / FAQ price / performer links on the HTML.
 *
 * Needs BrowserSession (wreq Chrome profile) to pass BrightStar's checkpoint.
 *
 * Usage:
 *   bun run scripts/scrape-everyevent.ts
 *   bun run scripts/scrape-everyevent.ts --limit 10
 *   bun run scripts/scrape-everyevent.ts <html_file> ...
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	makeAbsoluteUrl,
	sleep,
	superTrim,
} from "./common.ts";
import { BrowserSession } from "./browserSession.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SITE_BASE = `https://www.brightstarevents.com`;
const BALI_LISTING_URL = `${SITE_BASE}/en/discover/location/bali`;
const SITEMAP_INDEX = `${SITE_BASE}/sitemap.xml`;
const SOURCE = `everyevent` as const;
const TIMEZONE = `Asia/Makassar` as const;
const DETAIL_DELAY_MS = 1200;
const PAST_GRACE_MS = 12 * 60 * 60 * 1000;

/** Slug city segment after `--` in BrightStar imported event URLs. */
const BALI_SLUG_CITY_RE =
	/--(ubud|canggu|seminyak|uluwatu|payangan|sukawati|tejakula|gianyar|denpasar|sanur|jimbaran|tabanan|lovina|kerobokan|pererenan|north-west-bali|bali)--/i;

const BALI_PLACE_RE =
	/\b(bali|ubud|canggu|seminyak|uluwatu|payangan|sukawati|tejakula|gianyar|denpasar|sanur|jimbaran|tabanan|lovina|kerobokan|pererenan)\b/i;

const RUNNER_FLAGS = new Set([
	`--clean`,
	`--dry-run`,
	`--write-baseline`,
	`--exclude`,
	`--log-dir`,
]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching EveryEvent Bali (BrightStar)${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		const session = new BrowserSession();
		try {
			let listingHtml: string;
			try {
				listingHtml = await session.visit({ url: BALI_LISTING_URL });
			} catch (error) {
				console.error(`Failed to fetch Bali listing:`, error);
				return [];
			}

			const urls = new Set(extractListingUrls(listingHtml));
			console.error(`Listing yielded ${urls.size} event URLs.`);

			if (!resolvedLimit) {
				try {
					const fromSitemap = await collectBaliUrlsFromSitemap(session);
					for (const url of fromSitemap) urls.add(url);
					console.error(`After sitemap: ${urls.size} unique Bali-ish event URLs.`);
				} catch (error) {
					console.error(`Sitemap discovery failed (continuing with listing):`, error);
				}
			}

			const ordered = [...urls];
			const toFetch = resolvedLimit ? ordered.slice(0, resolvedLimit) : ordered;
			const events: ScrapedEvent[] = [];
			const seen = new Set<string>();

			for (const url of toFetch) {
				try {
					await sleep(DETAIL_DELAY_MS);
					const html = await session.visit({ url, referer: BALI_LISTING_URL });
					const event = mapDetailHtml({ html, url });
					if (!event) continue;
					if (seen.has(event.sourceUrl)) continue;
					seen.add(event.sourceUrl);
					events.push(event);
				} catch (error) {
					console.error(`Failed to process ${url}:`, error);
				}
			}

			events.sort((a, b) => a.startAt.localeCompare(b.startAt));
			console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
			return events;
		} finally {
			await session.close();
		}
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const url = inferFileUrl(filePath);
				const event = mapDetailHtml({ html, url });
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return mapDetailHtml({ html, url });
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

export function mapDetailHtml({
	html,
	url,
}: {
	html: string;
	url: string;
}): ScrapedEvent | undefined {
	if (!isBaliEvent(html, url)) {
		console.error(`Skipping ${url} (not a Bali event)`);
		return undefined;
	}

	const name = getName(html);
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl(html) || absoluteEventUrl(url);
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	if (matchesBlackListWords(name)) {
		console.error(`Skipping ${name} (blacklist)`);
		return undefined;
	}

	const description = getDescription(html);
	const haystack = `${name} ${cheerio.load(description ?? ``).root().text()} ${getTags(html).join(` `)}`;
	if (!matchesWhiteListWords(name) && !matchesWhiteListWords(haystack)) {
		console.error(`Skipping ${name} (whitelist)`);
		return undefined;
	}

	const endAt = getEndAt(html);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	return {
		name,
		startAt,
		endAt,
		timezone: TIMEZONE,
		address: getAddress(html),
		price: getPrice(html),
		priceIsHtml: false,
		description,
		imageUrls: getImageUrls(html),
		host: getHost(html),
		hostLink: getHostLink(html),
		contact: getContact(html),
		latitude: getLatitude(html),
		longitude: getLongitude(html),
		tags: getTags(html),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export function extractListingUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls: string[] = [];
	const seen = new Set<string>();

	$(`a.event-card[href*="/en/events/"]`).each((_i, el) => {
		try {
			const href = $(el).attr(`href`);
			const absolute = absoluteEventUrl(href);
			if (!absolute || seen.has(absolute)) return;
			seen.add(absolute);
			urls.push(absolute);
		} catch (error) {
			console.error(`Failed to parse listing card:`, error);
		}
	});

	return urls;
}

export async function collectBaliUrlsFromSitemap(session: BrowserSession): Promise<string[]> {
	const indexXml = await session.text({ url: SITEMAP_INDEX });
	const shards = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
	const urls: string[] = [];
	const seen = new Set<string>();

	for (const shard of shards) {
		try {
			const xml = await session.text({ url: shard });
			for (const match of xml.matchAll(/<loc>([^<]*\/en\/events\/[^<]+)<\/loc>/g)) {
				const absolute = absoluteEventUrl(match[1]);
				if (!absolute || seen.has(absolute)) continue;
				if (!looksLikeBaliEventUrl(absolute)) continue;
				seen.add(absolute);
				urls.push(absolute);
			}
		} catch (error) {
			console.error(`Failed to read sitemap shard ${shard}:`, error);
		}
	}

	return urls;
}

export function looksLikeBaliEventUrl(url: string): boolean {
	try {
		const path = new URL(url).pathname;
		if (BALI_SLUG_CITY_RE.test(path)) return true;
		return /\bbali\b/i.test(path);
	} catch {
		return false;
	}
}

export function isBaliEvent(html: string, url?: string): boolean {
	if (url && looksLikeBaliEventUrl(url)) return true;

	const schema = getEventSchema(html);
	const place = schema?.location;
	if (place && typeof place === `object`) {
		const region = readText(place.address?.addressRegion);
		const locality = readText(place.address?.addressLocality);
		const street = readText(place.address?.streetAddress);
		const country = readText(place.address?.addressCountry);
		const venue = readText(place.name);
		const blob = [region, locality, street, country, venue].filter(Boolean).join(` `);
		if (BALI_PLACE_RE.test(blob)) return true;
		if (/\bindonesia\b/i.test(blob) && BALI_PLACE_RE.test(getName(html) ?? ``)) return true;
	}

	return false;
}

export function getName(html: string): string | undefined {
	const fromSchema = readText(getEventSchema(html)?.name);
	if (fromSchema) return fromSchema;

	const $ = cheerio.load(html);
	const og = readText($(`meta[property="og:title"]`).attr(`content`)?.replace(/\s*[|·].*$/, ``));
	if (og) return og;

	return readText($(`h1`).first().text());
}

export function getStartAt(html: string): string | undefined {
	return toMakassarIso(getEventSchema(html)?.startDate);
}

export function getEndAt(html: string): string | undefined {
	return toMakassarIso(getEventSchema(html)?.endDate);
}

export function getAddress(html: string): string[] {
	const lines: string[] = [];
	const push = (value: string | undefined) => {
		const line = readText(value);
		if (!line) return;
		if (lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) return;
		lines.push(line);
	};

	const place = getEventSchema(html)?.location;
	if (place && typeof place === `object`) {
		push(place.name);
		const address = place.address;
		if (typeof address === `string`) {
			for (const part of address.split(`,`)) push(part);
		} else if (address && typeof address === `object`) {
			push(address.streetAddress);
			push(address.addressLocality);
			push(address.addressRegion);
			push(address.addressCountry);
		}
	}

	if (!lines.some((line) => /\bbali\b/i.test(line))) lines.push(`Bali`);
	return lines;
}

export function getPrice(html: string): string | undefined {
	const offers = getEventSchema(html)?.offers;
	const offer = Array.isArray(offers) ? offers[0] : offers;
	if (offer && typeof offer === `object`) {
		const amount = readText(String(offer.price ?? ``));
		const currency = readText(offer.priceCurrency) ?? `USD`;
		if (amount && amount !== `0` && amount !== `0.00`) {
			if (currency.toUpperCase() === `USD`) return `$${trimTrailingZeros(amount)}`;
			return `${trimTrailingZeros(amount)} ${currency}`;
		}
	}

	for (const faq of getFaqAnswers(html)) {
		const from = faq.match(
			/(?:starts? from|from|priced? at|costs?)\s*(\$\s*[\d,]+(?:\.\d+)?|\d[\d,.]*(?:\.\d+)?\s*(?:USD|IDR|EUR|€))/i,
		);
		if (from?.[1]) return superTrim(from[1].replace(/\s+/g, ` `));
		const bare = faq.match(/\$\s*[\d,]+(?:\.\d+)?/);
		if (bare?.[0] && /price|cost|ticket|inclusive/i.test(faq)) {
			return superTrim(bare[0].replace(/\s+/g, ``));
		}
	}

	return undefined;
}

export function getDescription(html: string): string | undefined {
	const raw = getEventSchema(html)?.description;
	if (typeof raw === `string` && raw.trim()) {
		const cleaned = cleanProseHtml(normalizeSchemaHtml(raw));
		if (cleaned?.trim()) return cleaned;
	}

	const $ = cheerio.load(html);
	const og = readText($(`meta[property="og:description"]`).attr(`content`));
	if (og) return cleanProseHtml(`<p>${escapeHtml(og)}</p>`) || undefined;
	return undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const push = (raw: string | undefined) => {
		const url = unwrapCloudinaryFetch(raw);
		if (!url?.startsWith(`http`)) return;
		if (/logo|favicon|sprite|icon/i.test(url)) return;
		if (urls.includes(url)) return;
		urls.push(url);
	};

	const schemaImage = getEventSchema(html)?.image;
	if (typeof schemaImage === `string`) push(schemaImage);
	else if (Array.isArray(schemaImage)) {
		for (const item of schemaImage) {
			if (typeof item === `string`) push(item);
		}
	}

	const $ = cheerio.load(html);
	push($(`meta[property="og:image"]`).attr(`content`));
	return urls;
}

export function getHost(html: string): string | undefined {
	const performers = asArray(getEventSchema(html)?.performer);
	for (const performer of performers) {
		if (!performer || typeof performer !== `object`) continue;
		const name = readText(performer.name);
		if (!name || /^brightstar$/i.test(name)) continue;
		return name;
	}
	return undefined;
}

export function getHostLink(html: string): string | undefined {
	const performers = asArray(getEventSchema(html)?.performer);
	for (const performer of performers) {
		if (!performer || typeof performer !== `object`) continue;
		const sameAs = asArray(performer.sameAs);
		for (const link of sameAs) {
			if (typeof link === `string` && link.startsWith(`http`) && !isBrightstarUrl(link)) {
				return link;
			}
		}
		const url = readText(performer.url);
		if (url?.startsWith(`http`) && !isBrightstarUrl(url)) return url;
	}
	return undefined;
}

export function getTags(html: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	const push = (value: string | undefined) => {
		const tag = readText(value);
		if (!tag) return;
		const key = tag.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(tag);
	};

	const $ = cheerio.load(html);
	$(`a.genre-tag, .genre-tag`).each((_i, el) => push($(el).text()));
	return tags;
}

export function getContact(html: string): string[] {
	const contact: string[] = [];
	const push = (value: string | undefined) => {
		const url = readText(value);
		if (!url?.startsWith(`http`)) return;
		if (contact.includes(url)) return;
		contact.push(url);
	};

	const offers = getEventSchema(html)?.offers;
	const offer = Array.isArray(offers) ? offers[0] : offers;
	if (offer && typeof offer === `object`) push(offer.url);

	const hostLink = getHostLink(html);
	push(hostLink);

	const $ = cheerio.load(html);
	$(`a[href^="http"]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		const text = $(el).text();
		if (!href || isBrightstarUrl(href)) return;
		if (/get tickets|organizer.?s?\s*site|official site|register|tickets/i.test(text) || /register|ticket/i.test(href)) {
			push(href);
		}
	});

	return contact;
}

export function getLatitude(html: string): number | null {
	const geo = getEventSchema(html)?.location;
	if (!geo || typeof geo !== `object`) return null;
	const lat = Number(geo.geo?.latitude);
	return Number.isFinite(lat) ? lat : null;
}

export function getLongitude(html: string): number | null {
	const geo = getEventSchema(html)?.location;
	if (!geo || typeof geo !== `object`) return null;
	const lng = Number(geo.geo?.longitude);
	return Number.isFinite(lng) ? lng : null;
}

export function getSourceUrl(html: string): string | undefined {
	const fromSchema = readText(getEventSchema(html)?.url);
	if (fromSchema?.startsWith(`http`)) return absoluteEventUrl(fromSchema);

	const $ = cheerio.load(html);
	const canonical = $(`link[rel="canonical"]`).attr(`href`);
	if (canonical) return absoluteEventUrl(canonical);

	const og = $(`meta[property="og:url"]`).attr(`content`);
	if (og) return absoluteEventUrl(og);
	return undefined;
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
		if (arg.startsWith(`-`)) {
			if (RUNNER_FLAGS.has(arg) || arg === `--exclude` || arg === `--log-dir`) {
				if (arg === `--exclude` || arg === `--log-dir`) i++;
				continue;
			}
			continue;
		}
		files.push(arg);
	}

	return { limit, files };
}

export function getEventSchema(html: string): JsonLdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const raw = $(el).html();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			const event = jsonLdNodes(parsed).find(
				(node) => isEventType(node[`@type` as string]) && typeof node.startDate === `string`,
			);
			if (event) return event as JsonLdEvent;
		} catch (error) {
			console.error(`Event JSON-LD is not valid JSON:`, error);
		}
	}
	return undefined;
}

function getFaqAnswers(html: string): string[] {
	const answers: string[] = [];
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const raw = $(el).html();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			for (const node of jsonLdNodes(parsed)) {
				if (!isType(node[`@type` as string], `FAQPage`)) continue;
				const entities = asArray(node.mainEntity);
				for (const entity of entities) {
					if (!entity || typeof entity !== `object`) continue;
					const text = readText(
						(entity as { acceptedAnswer?: { text?: string } }).acceptedAnswer?.text,
					);
					if (text) answers.push(text);
				}
			}
		} catch {
			// ignore bad FAQ blocks
		}
	}
	return answers;
}

function toMakassarIso(value: unknown): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;

	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone: TIMEZONE,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
		hour: `2-digit`,
		minute: `2-digit`,
		hourCycle: `h23`,
	}).formatToParts(date);

	const year = Number(parts.find((part) => part.type === `year`)?.value);
	const month = Number(parts.find((part) => part.type === `month`)?.value);
	const day = Number(parts.find((part) => part.type === `day`)?.value);
	const hour = Number(parts.find((part) => part.type === `hour`)?.value);
	const minute = Number(parts.find((part) => part.type === `minute`)?.value);
	if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;

	return dateToIsoStr(year, month, day, hour, minute, TIMEZONE, false);
}

function isUpcoming({ startAt, endAt }: { startAt: string; endAt?: string | null }): boolean {
	const endMs = endAt ? new Date(endAt).getTime() : new Date(startAt).getTime();
	return Number.isFinite(endMs) && endMs + PAST_GRACE_MS >= Date.now();
}

function absoluteEventUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const absolute = makeAbsoluteUrl(url, SITE_BASE) ?? url;
	try {
		const parsed = new URL(absolute);
		parsed.hash = ``;
		return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, ``) || absolute;
	} catch {
		return absolute;
	}
}

function unwrapCloudinaryFetch(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const match = url.match(/\/image\/fetch\/[^/]+\/(https?[^&\s"']+)/i);
	if (!match?.[1]) return url;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

function normalizeSchemaHtml(raw: string): string {
	// BrightStar sometimes emits broken tags like `<p<span...>` — strip tags to prose.
	if (/<[a-z][^>]*>/i.test(raw) && !/<(?:p|div|br|ul|ol|li|h\d)\b/i.test(raw)) {
		const text = cheerio.load(`<div>${raw}</div>`)(`div`).text();
		return `<p>${escapeHtml(superTrim(text) ?? text)}</p>`;
	}
	if (!/<[a-z][\s\S]*>/i.test(raw)) {
		return `<p>${escapeHtml(raw)}</p>`;
	}
	return raw;
}

function isBrightstarUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return /(^|\.)brightstarevents\.com$/i.test(host) || /(^|\.)everyevent/i.test(host);
	} catch {
		return false;
	}
}

function jsonLdNodes(parsed: unknown): JsonLdNode[] {
	if (!parsed) return [];
	if (Array.isArray(parsed)) return parsed.flatMap(jsonLdNodes);
	if (typeof parsed !== `object`) return [];
	const node = parsed as JsonLdNode;
	const graph = node[`@graph` as string];
	if (Array.isArray(graph)) return [node, ...graph.flatMap(jsonLdNodes)];
	return [node];
}

function isEventType(value: unknown): boolean {
	return isType(value, `Event`) || isType(value, `MusicEvent`);
}

function isType(value: unknown, expected: string): boolean {
	if (typeof value === `string`) return value === expected;
	if (Array.isArray(value)) return value.includes(expected);
	return false;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	return superTrim(value);
}

function trimTrailingZeros(amount: string): string {
	if (!amount.includes(`.`)) return amount;
	return amount.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``);
}

function escapeHtml(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function inferFileUrl(filePath: string): string {
	const base = filePath.split(`/`).pop()?.replace(/\.html?$/i, ``) ?? `unknown`;
	return `${SITE_BASE}/en/events/${base}`;
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

type JsonLdNode = Record<string, unknown> & {
	mainEntity?: unknown;
};

type JsonLdEvent = {
	name?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	url?: string;
	image?: string | string[];
	offers?: JsonLdOffer | JsonLdOffer[];
	location?: {
		name?: string;
		address?:
			| string
			| {
					streetAddress?: string;
					addressLocality?: string;
					addressRegion?: string;
					addressCountry?: string;
			  };
		geo?: { latitude?: number | string; longitude?: number | string };
	};
	performer?: JsonLdPerformer | JsonLdPerformer[];
	organizer?: { name?: string; url?: string };
};

type JsonLdOffer = {
	price?: string | number;
	priceCurrency?: string;
	url?: string;
};

type JsonLdPerformer = {
	name?: string;
	url?: string;
	sameAs?: string | string[];
};
