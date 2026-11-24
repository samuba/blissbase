/**
 * Scrapes NOW! Bali upcoming events.
 *
 * Listing: WP REST `/wp-json/wp/v2/upcoming-events` (titles + permalinks).
 * Detail: each `/upcoming-events/{slug}/` HTML page — dates, venue, body,
 * address footer, and category live in the template (not in public ACF/REST).
 *
 * Usage:
 *   bun run scripts/scrape-nowbali.ts
 *   bun run scripts/scrape-nowbali.ts --limit 10
 *   bun run scripts/scrape-nowbali.ts <html_file> ...
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	REQUEST_DELAY_MS,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	sleep,
	superTrim,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://www.nowbali.co.id`;
const LISTING_API = `${SITE_BASE}/wp-json/wp/v2/upcoming-events`;
const SOURCE = `nowbali` as const;
const DEFAULT_TIMEZONE = `Asia/Makassar` as const;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const UPCOMING_GRACE_MS = 6 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12,
};

const DATE_TOKEN = `(\\d{1,2})\\s+(${Object.keys(MONTHS).join(`|`)})\\s+(\\d{4})`;
const DATE_RANGE_RE = new RegExp(`^\\s*${DATE_TOKEN}\\s*[-–—]\\s*${DATE_TOKEN}\\s*$`, `i`);
const SINGLE_DATE_RE = new RegExp(`^\\s*${DATE_TOKEN}\\s*$`, `i`);
const TIME_PART = `(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)`;
const OVERALL_TIME_RE = new RegExp(
	`\\b(?:from|held\\s+from|kicks\\s+off\\s+at|opens?\\s+at)\\s*${TIME_PART}\\s*(?:[-–—]|to|until)\\s*${TIME_PART}\\b`,
	`i`,
);
const DAILY_TIME_RE = new RegExp(
	`\\b${TIME_PART}\\s*(?:[-–—]|to|until)\\s*${TIME_PART}\\s*daily\\b`,
	`i`,
);
const TIME_RANGE_RE = new RegExp(
	`\\b${TIME_PART}\\s*(?:[-–—]|to|until)\\s*${TIME_PART}\\b`,
	`i`,
);
const PHONE_RE = /\+?\d[\d\s\-()]{7,}\d/;
const PRICE_TICKET_RE =
	/\b(?:tickets?\s+(?:are\s+)?priced\s+at|ticket\s+is\s+priced\s+at|priced\s+at)\s*(IDR\s*[\d.,]+(?:\+\+)?(?:\s*per\s+\w+)?)/i;
const PRICE_IDR_RE = /\bIDR\s*[\d.,]{4,}(?:\+\+)?(?:\s*per\s+\w+)?(?!\s*(?:million|billion))/i;
/** Admission-only free signals — not bare “free” / “complimentary” in prose. */
const FREE_PRICE_RE =
	/\b(?:free\s+to\s+(?:view|enter|attend)|free\s+entry|admission\s+is\s+free|no\s+charge|complimentary\s+(?:admission|entry))\b/i;
const RUNNER_FLAGS = new Set([`--clean`, `--dry-run`, `--write-baseline`, `--exclude`, `--log-dir`]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching NOW! Bali upcoming-events via WP REST${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let listings: ListingItem[];
		try {
			listings = await fetchListings();
		} catch (error) {
			console.error(`Failed to fetch NOW! Bali listings:`, error);
			return [];
		}

		const candidates = listings.filter((item) => passesNameLists(item.title));
		console.error(
			`Listed ${listings.length} events; ${candidates.length} match whitelist (fetching details)...`,
		);

		const events: ScrapedEvent[] = [];
		const seen = new Set<string>();
		let skippedPast = 0;

		for (const item of candidates) {
			if (resolvedLimit != null && events.length >= resolvedLimit) break;
			try {
				await sleep(REQUEST_DELAY_MS);
				const html = await customFetch(item.link, { returnType: `text` });
				const event = await mapDetailHtml({ html, url: item.link });
				if (!event) {
					// Past events also return undefined after date parse — count when dates exist but ended.
					const startAt = getStartAt(html);
					const endAt = getEndAt(html);
					if (startAt && !isUpcoming({ startAt, endAt })) skippedPast += 1;
					continue;
				}
				if (seen.has(event.sourceUrl)) continue;
				seen.add(event.sourceUrl);
				events.push(event);
			} catch (error) {
				console.error(`Failed to process ${item.link}:`, error);
			}
		}

		events.sort((a, b) => a.startAt.localeCompare(b.startAt));
		console.error(
			`--- Scraping finished. Total events: ${events.length} (skipped past: ${skippedPast}) ---`,
		);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const url = getSourceUrl(html) || filePath;
				const event = await mapDetailHtml({ html, url });
				if (!event) continue;
				if (!isUpcoming({ startAt: event.startAt, endAt: event.endAt })) continue;
				events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapDetailHtml({ html, url });
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

export async function mapDetailHtml({
	html,
	url,
	geocode = true,
}: {
	html: string;
	url: string;
	geocode?: boolean;
}): Promise<ScrapedEvent | undefined> {
	const name = getName(html);
	const startAt = getStartAt(html);
	const endAt = getEndAt(html);
	const sourceUrl = getSourceUrl(html) || url;
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name or start date.`);
		return undefined;
	}
	if (!passesNameLists(name)) {
		console.error(`Skipping ${url}: name failed whitelist/blacklist.`);
		return undefined;
	}
	if (!isUpcoming({ startAt, endAt })) {
		return undefined;
	}

	const address = getAddress(html);
	let latitude: number | null = null;
	let longitude: number | null = null;
	let timezone: string | null = DEFAULT_TIMEZONE;

	if (geocode && address?.length) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: [...address, `Bali`, `Indonesia`],
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
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
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export async function fetchListings(): Promise<ListingItem[]> {
	const items: ListingItem[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = `${LISTING_API}?per_page=${PAGE_SIZE}&page=${page}&_fields=id,slug,link,title`;
		const response = await fetch(url, {
			headers: { Accept: `application/json`, "User-Agent": `BlissbaseScraper/1.0` },
			signal: AbortSignal.timeout(30_000),
		});
		if (response.status === 400) break;
		if (!response.ok) {
			throw new Error(`NOW! Bali listing HTTP ${response.status} for ${url}`);
		}

		const batch = (await response.json()) as WpListing[];
		if (!batch?.length) break;

		for (const row of batch) {
			const link = typeof row.link === `string` ? row.link.trim() : ``;
			const title = decodeWpTitle(row.title?.rendered);
			if (!link || !title) continue;
			if (seen.has(link)) continue;
			seen.add(link);
			items.push({ id: row.id, slug: row.slug, link, title });
		}

		const totalPages = Number(response.headers.get(`X-WP-TotalPages`) || 1);
		if (page >= totalPages) break;
		await sleep(REQUEST_DELAY_MS);
	}

	return items;
}

export function getName(html: string): string | undefined {
	const $ = cheerio.load(html);
	return (
		superTrim($(`article h1`).first().text()) ||
		superTrim($(`h1`).first().text()) ||
		undefined
	);
}

export function getStartAt(html: string): string | undefined {
	const range = parseDateRangeText(dateRangeText(html));
	if (!range) return undefined;
	const times = parseTimeRange(postEntryText(html));
	return toIso({
		parts: range.start,
		hour: times?.start.hour ?? 0,
		minute: times?.start.minute ?? 0,
	});
}

export function getEndAt(html: string): string | undefined {
	const range = parseDateRangeText(dateRangeText(html));
	if (!range) return undefined;
	const times = parseTimeRange(postEntryText(html));
	const endHour = times?.end.hour;
	const endMinute = times?.end.minute;
	const sameDay =
		range.start.year === range.end.year &&
		range.start.month === range.end.month &&
		range.start.day === range.end.day;

	if (sameDay && endHour == null) return undefined;

	return toIso({
		parts: range.end,
		hour: endHour ?? 23,
		minute: endMinute ?? (endHour == null ? 59 : 0),
	});
}

export function getAddress(html: string): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		if (isContactish(text)) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	push(getVenue(html));

	const footer = venueFooterLines(html);
	for (const line of footer) {
		if (isContactish(line)) continue;
		push(line);
	}

	if (lines?.length && !lines.some((line) => /\bbali\b/i.test(line))) {
		push(`Bali`);
	}

	return lines;
}

export function getPrice(html: string): string | undefined {
	const text = postEntryText(html);
	const ticket = text.match(PRICE_TICKET_RE)?.[1];
	if (ticket) return superTrim(ticket);
	const idr = text.match(PRICE_IDR_RE)?.[0];
	if (idr) return superTrim(idr);
	if (FREE_PRICE_RE.test(text)) return `Free`;
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const $entry = $(`article .post-entry`).first();
	if (!$entry.length) return undefined;

	const clone = $entry.clone();
	clone.find(`h1, script, style, .fw-bold.fs-6, .pb-3.fs-6, .pb-5.border-bottom`).remove();
	clone.find(`img`).remove();

	// Drop trailing venue/contact block (last <p> that is mostly contact lines).
	const paragraphs = clone.children(`p`).toArray();
	if (paragraphs?.length) {
		const $last = $(paragraphs[paragraphs.length - 1]);
		const lastHtml = $last.html() || ``;
		const lastText = superTrim($last.text()) ?? ``;
		if (/<br\s*\/?>/i.test(lastHtml) && looksLikeVenueFooter(lastText)) $last.remove();
	}

	const inner = clone.html()?.trim();
	if (!inner) return undefined;
	return cleanProseHtml(inner) || undefined;
}

export function getImageUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls: string[] = [];
	const seen = new Set<string>();

	const push = (raw: string | undefined) => {
		const abs = makeAbsoluteUrl(raw?.trim(), SITE_BASE);
		if (!abs) return;
		if (!/\.(jpe?g|png|webp)(\?|$)/i.test(abs) && !abs.includes(`/wp-content/uploads/`)) return;
		if (seen.has(abs)) return;
		seen.add(abs);
		urls.push(abs);
	};

	push($(`article img`).first().attr(`src`));
	push($(`meta[property="og:image"]`).attr(`content`));

	$(`article .post-entry img`).each((_i, el) => {
		push($(el).attr(`src`));
	});

	return urls;
}

export function getHost(html: string): string | undefined {
	return getVenue(html);
}

export function getHostLink(html: string): string | undefined {
	const footer = venueFooterLines(html);
	for (const line of footer) {
		const href = extractHttpUrl(line);
		if (href) return href;
	}

	const $ = cheerio.load(html);
	const $entry = $(`article .post-entry`).first();
	const $lastLink = $entry.find(`p`).last().find(`a[href]`).last();
	const href = $lastLink.attr(`href`)?.trim();
	if (!href) return undefined;
	if (href.includes(`nowbali.co.id`)) return undefined;
	if (href.startsWith(`mailto:`) || href.startsWith(`tel:`)) return undefined;
	return makeAbsoluteUrl(href, SITE_BASE) || href;
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(text);
	};

	for (const line of venueFooterLines(html)) {
		if (PHONE_RE.test(line) && !/@/.test(line)) {
			push(line.replace(/\s+/g, ` `));
			continue;
		}
		const url = extractHttpUrl(line);
		if (url) push(url);
	}

	const hostLink = getHostLink(html);
	if (hostLink) push(hostLink);

	return contacts;
}

export function getTags(html: string): string[] {
	const $ = cheerio.load(html);
	const tags: string[] = [];
	const seen = new Set<string>();

	$(`article a[href*="/event-category/"]`).each((_i, el) => {
		const tag = superTrim($(el).text());
		if (!tag) return;
		const key = tag.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(tag);
	});

	return tags;
}

export function getSourceUrl(html: string): string | undefined {
	const $ = cheerio.load(html);
	const canonical = $(`link[rel="canonical"]`).attr(`href`)?.trim();
	if (canonical?.includes(`/upcoming-events/`)) return canonical;
	const og = $(`meta[property="og:url"]`).attr(`content`)?.trim();
	if (og?.includes(`/upcoming-events/`)) return og;
	return undefined;
}

export function getVenue(html: string): string | undefined {
	const $ = cheerio.load(html);
	return superTrim($(`article .post-entry > .pb-3.fs-6`).first().text()) || undefined;
}

export function parseDateRangeText(raw: string | undefined): DateRange | undefined {
	const text = superTrim(raw);
	if (!text) return undefined;

	const range = text.match(DATE_RANGE_RE);
	if (range) {
		const start = partsFromMatch(range, 1);
		const end = partsFromMatch(range, 4);
		if (!start || !end) return undefined;
		return { start, end };
	}

	const single = text.match(SINGLE_DATE_RE);
	if (single) {
		const parts = partsFromMatch(single, 1);
		if (!parts) return undefined;
		return { start: parts, end: parts };
	}

	return undefined;
}

export function parseTimeRange(text: string | undefined): {
	start: { hour: number; minute: number };
	end: { hour: number; minute: number };
} | undefined {
	if (!text) return undefined;
	// Prefer whole-day / door phrases over session schedules like "(9am – 10am)".
	const match = text.match(OVERALL_TIME_RE) || text.match(DAILY_TIME_RE) || text.match(TIME_RANGE_RE);
	if (!match) return undefined;

	const start = to24h({ hour: Number(match[1]), minute: Number(match[2] || 0), meridiem: match[3] });
	const end = to24h({ hour: Number(match[4]), minute: Number(match[5] || 0), meridiem: match[6] });
	if (!start || !end) return undefined;
	return { start, end };
}

export function passesNameLists(name: string | undefined): boolean {
	if (!name) return false;
	if (matchesBlackListWords(name)) return false;
	return matchesWhiteListWords(name);
}

export function isUpcoming({
	startAt,
	endAt,
	now = Date.now(),
}: {
	startAt: string;
	endAt?: string | null;
	now?: number;
}): boolean {
	const endMs = Date.parse(endAt || startAt);
	if (!Number.isFinite(endMs)) return false;
	return endMs + UPCOMING_GRACE_MS >= now;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg.startsWith(`--limit=`)) {
			const value = arg === `--limit` ? argv[++i] : arg.slice(`--limit=`.length);
			const parsed = Number(value);
			if (Number.isFinite(parsed) && parsed > 0) limit = Math.floor(parsed);
			continue;
		}
		if (arg === `--`) continue;
		if (RUNNER_FLAGS.has(arg)) {
			if (arg === `--exclude` || arg === `--log-dir`) i += 1;
			continue;
		}
		if (arg.startsWith(`-`)) continue;
		files.push(arg);
	}

	return { limit, files };
}

function dateRangeText(html: string): string | undefined {
	const $ = cheerio.load(html);
	return superTrim($(`article .post-entry > .fw-bold.fs-6`).first().text()) || undefined;
}

function postEntryText(html: string): string {
	const $ = cheerio.load(html);
	return superTrim($(`article .post-entry`).first().text()) ?? ``;
}

function venueFooterLines(html: string): string[] {
	const $ = cheerio.load(html);
	const $entry = $(`article .post-entry`).first();
	if (!$entry.length) return [];

	const paragraphs = $entry.children(`p`).toArray();
	for (let i = paragraphs.length - 1; i >= 0; i--) {
		const $p = $(paragraphs[i]);
		const htmlChunk = $p.html() || ``;
		// Venue blocks are br-separated lines under a bold venue name.
		if (!/<br\s*\/?>/i.test(htmlChunk)) continue;
		if (!/<strong[\s>]/i.test(htmlChunk)) continue;

		const text = superTrim($p.text()) ?? ``;
		if (!looksLikeVenueFooter(text)) continue;

		return htmlChunk
			.split(/<br\s*\/?>/i)
			.map((part) => superTrim(cheerio.load(`<div>${part}</div>`)(`div`).text()) || ``)
			.filter(Boolean);
	}

	return [];
}

function looksLikeVenueFooter(text: string): boolean {
	if (!text) return false;
	if (/^for more information\b/i.test(text)) return false;
	const hasPhone = PHONE_RE.test(text);
	const hasHandle = /@[\w.]+/.test(text);
	const hasDomain = /\b[\w.-]+\.(com|id|net|org|co)\b/i.test(text);
	const short = text.length < 280;
	return short && (hasPhone || hasHandle || hasDomain);
}

function isContactish(text: string): boolean {
	if (PHONE_RE.test(text) && !/[a-zA-Z]{3,}/.test(text.replace(PHONE_RE, ``))) return true;
	if (/^@[\w.]+$/.test(text)) return true;
	if (/^https?:\/\//i.test(text)) return true;
	if (/^[\w.-]+\.(com|id|net|org|co)(\/|$)/i.test(text)) return true;
	return false;
}

function extractHttpUrl(text: string): string | undefined {
	const absolute = text.match(/https?:\/\/[^\s]+/i)?.[0];
	if (absolute) return absolute.replace(/[),.;]+$/, ``);
	const domain = text.match(/\b([\w.-]+\.(?:com|id|net|org|co)(?:\/[^\s]*)?)\b/i)?.[1];
	if (!domain) return undefined;
	if (domain.includes(`nowbali.co.id`)) return undefined;
	return `https://${domain.replace(/^\/+/, ``)}`;
}

function partsFromMatch(match: RegExpMatchArray, offset: number): DateParts | undefined {
	const day = Number(match[offset]);
	const month = MONTHS[match[offset + 1].toLowerCase()];
	const year = Number(match[offset + 2]);
	if (!month || !day || !year) return undefined;
	if (day < 1 || day > 31) return undefined;
	return { year, month, day };
}

function to24h({
	hour,
	minute,
	meridiem,
}: {
	hour: number;
	minute: number;
	meridiem: string;
}): { hour: number; minute: number } | undefined {
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
	if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return undefined;
	const pm = meridiem.toLowerCase() === `pm`;
	let h = hour % 12;
	if (pm) h += 12;
	return { hour: h, minute };
}

function toIso({
	parts,
	hour,
	minute,
}: {
	parts: DateParts;
	hour: number;
	minute: number;
}): string {
	return dateToIsoStr(parts.year, parts.month, parts.day, hour, minute, DEFAULT_TIMEZONE, false);
}

function decodeWpTitle(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const $ = cheerio.load(`<textarea>${raw}</textarea>`);
	return superTrim($(`textarea`).text()) || undefined;
}

if (import.meta.main) {
	try {
		const { limit, files } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length
			? await scraper.scrapeHtmlFiles(files)
			: await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type DateParts = { year: number; month: number; day: number };
type DateRange = { start: DateParts; end: DateParts };

type ListingItem = {
	id: number;
	slug: string;
	link: string;
	title: string;
};

type WpListing = {
	id: number;
	slug: string;
	link: string;
	title?: { rendered?: string };
};
