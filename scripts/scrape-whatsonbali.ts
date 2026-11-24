/**
 * Scrapes whatsonbali.com events.
 *
 * Listing: WP REST `GET /wp-json/wp/v2/wob_event` (paginated).
 * Detail: each event permalink HTML — Event JSON-LD + page fields via get*.
 * Recurring events expand up to 90 days from the next occurrence.
 *
 * Usage:
 *   bun run scripts/scrape-whatsonbali.ts
 *   bun run scripts/scrape-whatsonbali.ts --limit 5
 *   bun run scripts/scrape-whatsonbali.ts <html_file> ...
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	sleep,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://whatsonbali.com`;
const EVENTS_API = `${SITE_BASE}/wp-json/wp/v2/wob_event`;
const SOURCE = `whatsonbali` as const;
const TIMEZONE = `Asia/Makassar` as const;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DETAIL_DELAY_MS = 250;
const OCCURRENCE_DAYS_AHEAD = 90;
const RUNNER_FLAGS = new Set([
	`--clean`,
	`--dry-run`,
	`--write-baseline`,
	`--exclude`,
	`--log-dir`,
]);

const WEEKDAY_NAMES = [
	`sunday`,
	`monday`,
	`tuesday`,
	`wednesday`,
	`thursday`,
	`friday`,
	`saturday`,
] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching What's On Bali events via WP REST${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let listings: WobListing[];
		try {
			listings = await fetchAllListings({ limit: resolvedLimit });
		} catch (error) {
			console.error(`Failed to fetch What's On Bali event index:`, error);
			return [];
		}
		console.error(`Loaded ${listings.length} event listings. Fetching detail pages...`);

		const events: ScrapedEvent[] = [];
		const seen = new Set<string>();

		for (const listing of listings) {
			try {
				const html = await customFetch(listing.link, { returnType: `text` });
				const mapped = await mapDetailHtml({ html, url: listing.link, listing });
				for (const event of mapped) {
					const key = `${normalizeKey(event.name)}|${event.startAt}`;
					if (seen.has(key)) continue;
					seen.add(key);
					events.push(event);
				}
				await sleep(DETAIL_DELAY_MS);
			} catch (error) {
				console.error(`Failed to process ${listing.link}:`, error);
			}
		}

		events.sort((a, b) => a.startAt.localeCompare(b.startAt));
		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const mapped = await mapDetailHtml({ html, url: filePath });
				events.push(...mapped);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			const mapped = await mapDetailHtml({ html, url });
			return mapped[0];
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
	listing,
}: {
	html: string;
	url: string;
	listing?: WobListing;
}): Promise<ScrapedEvent[]> {
	const name = getName(html);
	const startAt = getStartAt(html) || listing?.nextStart || listing?.start;
	const sourceUrl = getSourceUrl(html) || listing?.link || absoluteUrl(url);
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name, start, or sourceUrl.`);
		return [];
	}

	const endAt = getEndAt(html) || listing?.nextEnd || listing?.end || null;
	const base: ScrapedEvent = {
		name,
		startAt,
		endAt,
		timezone: TIMEZONE,
		address: getAddress(html, listing),
		price: getPrice(html) || listing?.priceLabel || undefined,
		priceIsHtml: false,
		description: getDescription(html),
		imageUrls: getImageUrls(html) || (listing?.imageUrl ? [listing.imageUrl] : []),
		host: getHost(html) || listing?.venue || undefined,
		hostLink: getHostLink(html),
		contact: getContact(html, listing),
		latitude: null,
		longitude: null,
		tags: getTags(html, listing),
		sourceUrl,
		source: SOURCE,
	};

	await fillCoordinates(base);

	const recurrence = getRecurrence(html) || listing?.recurring;
	const occurrences = expandOccurrences({
		startAt: base.startAt,
		endAt: base.endAt,
		recurrence,
		daysAhead: OCCURRENCE_DAYS_AHEAD,
	});

	return occurrences.map((occurrence) => ({
		...base,
		startAt: occurrence.startAt,
		endAt: occurrence.endAt,
		sourceUrl: occurrenceSourceUrl({ sourceUrl: base.sourceUrl, startAt: occurrence.startAt, recurring: !!recurrence }),
	}));
}

export async function fetchAllListings({ limit }: { limit?: number } = {}): Promise<WobListing[]> {
	const listings: WobListing[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = new URL(EVENTS_API);
		url.searchParams.set(`per_page`, String(PAGE_SIZE));
		url.searchParams.set(`page`, String(page));
		url.searchParams.set(`orderby`, `date`);
		url.searchParams.set(`order`, `desc`);

		const rows = (await customFetch(url.toString(), { returnType: `json` })) as unknown;
		if (!Array.isArray(rows)) {
			throw new Error(`Unexpected wob_event response on page ${page}`);
		}
		if (!rows.length) break;

		for (const row of rows) {
			const listing = parseListing(row);
			if (!listing) continue;
			listings.push(listing);
			if (limit && listings.length >= limit) return listings;
		}

		console.error(`  REST page ${page} — ${listings.length} listings so far`);
		if (rows.length < PAGE_SIZE) break;
		await sleep(100);
	}

	return listings;
}

export function getName(html: string): string | undefined {
	const schema = getEventSchema(html);
	const fromSchema = cleanText(schema?.name);
	if (fromSchema) return fromSchema;

	const $ = cheerio.load(html);
	const fromHero = cleanText($(`.wob-hero-d h1`).first().text());
	if (fromHero) return fromHero;

	const fromOg = cleanText($(`meta[property="og:title"]`).attr(`content`)?.replace(/,.*/, ``));
	return fromOg || undefined;
}

export function getStartAt(html: string): string | undefined {
	return normalizeIso(getEventSchema(html)?.startDate);
}

export function getEndAt(html: string): string | undefined {
	return normalizeIso(getEventSchema(html)?.endDate);
}

export function getAddress(html: string, listing?: WobListing): string[] {
	const lines: string[] = [];
	const schema = getEventSchema(html);
	const place = schema?.location;

	const venue = cleanText(typeof place === `object` ? place?.name : undefined) || listing?.venue;
	if (venue) lines.push(venue);

	const street = cleanText(typeof place === `object` ? place?.address : undefined);
	if (street) {
		for (const part of street.split(`,`)) {
			const line = part.trim();
			if (!line) continue;
			if (lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) continue;
			lines.push(line);
		}
	}

	const $ = cheerio.load(html);
	const area = cleanText($(`.wob-hero-d__meta`).first().text()) || listing?.areaName;
	if (area && !lines.some((line) => line.toLowerCase().includes(area.toLowerCase()))) {
		lines.push(area);
	}

	if (!lines.some((line) => /\bbali\b/i.test(line))) lines.push(`Bali`);
	return lines;
}

export function getPrice(html: string): string | undefined {
	const $ = cheerio.load(html);
	const buy = $(`#wob-buy, .wob-buy`).first();
	const freeLabel = cleanText(buy.find(`.is-free`).first().text());
	if (freeLabel) return freeLabel;
	if (/\bFree entry\b/i.test(buy.text()) || buy.find(`b`).filter((_, el) => /^free$/i.test($(el).text().trim())).length) {
		return `Free entry`;
	}

	const priced = cleanText(buy.find(`.wob-pb b, .wob-qi b`).first().text());
	if (priced && !/ticket|official site|entry and ticket/i.test(priced)) return priced;

	const fromIdr = buy.text().match(/From\s+IDR[\d.\s]+/i)?.[0];
	if (fromIdr) return cleanText(fromIdr);

	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const rich = $(`.wob-rich`).first().html();
	const cleaned = cleanProseHtml(rich || undefined);
	if (cleaned?.trim()) return cleaned;

	const schema = getEventSchema(html);
	const text = cleanText(schema?.description);
	if (!text) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(text)}</p>`) || undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const schema = getEventSchema(html);
	const schemaImage = schema?.image;
	if (typeof schemaImage === `string` && schemaImage.startsWith(`http`)) {
		urls.push(preferFullImageUrl(schemaImage));
	} else if (Array.isArray(schemaImage)) {
		for (const item of schemaImage) {
			if (typeof item === `string` && item.startsWith(`http`)) urls.push(preferFullImageUrl(item));
		}
	}

	const $ = cheerio.load(html);
	const og = $(`meta[property="og:image"]`).attr(`content`)?.trim();
	if (og?.startsWith(`http`) && !urls.includes(og)) urls.push(preferFullImageUrl(og));

	const heroBg = $(`.wob-hero-d`).attr(`style`)?.match(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/i)?.[2];
	if (heroBg && !urls.includes(heroBg)) urls.push(preferFullImageUrl(heroBg));

	return [...new Set(urls)];
}

export function getHost(html: string): string | undefined {
	const $ = cheerio.load(html);
	return cleanText($(`.wob-org strong`).first().text()) || undefined;
}

export function getHostLink(html: string): string | undefined {
	const $ = cheerio.load(html);
	const href = $(`.wob-org a[href]`).first().attr(`href`)?.trim();
	if (!href?.startsWith(`http`)) return undefined;
	if (/wa\.me|whatsapp|mailto:/i.test(href)) return undefined;
	return href;
}

export function getTags(html: string, listing?: WobListing): string[] {
	const tags = new Set<string>();
	const $ = cheerio.load(html);
	const pill = cleanText($(`.wob-hero-d .wob-pill`).first().text());
	if (pill) tags.add(pill);
	if (listing?.categoryName) tags.add(listing.categoryName);
	if (listing?.areaName) tags.add(listing.areaName);
	return [...tags];
}

export function getSourceUrl(html: string): string | undefined {
	const schema = getEventSchema(html);
	const fromSchema = cleanText(schema?.url);
	if (fromSchema?.startsWith(`http`)) return fromSchema;

	const $ = cheerio.load(html);
	const canonical = $(`link[rel="canonical"]`).attr(`href`)?.trim();
	if (canonical?.startsWith(`http`)) return canonical;

	const og = $(`meta[property="og:url"]`).attr(`content`)?.trim();
	if (og?.startsWith(`http`)) return og;
	return undefined;
}

export function getRecurrence(html: string): string | undefined {
	const $ = cheerio.load(html);
	let recurrence: string | undefined;
	$(`.wob-evbox__rows li`).each((_, el) => {
		const label = cleanText($(el).find(`span`).first().text())?.toLowerCase();
		if (label !== `repeats`) return;
		recurrence = cleanText($(el).find(`b`).first().text());
	});
	return recurrence;
}

export function getContact(html: string, listing?: WobListing): string[] {
	const contact: string[] = [];
	const $ = cheerio.load(html);
	const ticketHref = $(`a[data-wob-out][href]`).first().attr(`href`)?.trim() || listing?.ticketUrl;
	if (ticketHref?.startsWith(`http`) && !contact.includes(ticketHref)) contact.push(ticketHref);
	return contact;
}

export function expandOccurrences({
	startAt,
	endAt,
	recurrence,
	daysAhead,
}: {
	startAt: string;
	endAt: string | null | undefined;
	recurrence: string | null | undefined;
	daysAhead: number;
}): { startAt: string; endAt: string | null }[] {
	const startMs = Date.parse(startAt);
	if (Number.isNaN(startMs)) return [];

	const endMs = endAt ? Date.parse(endAt) : Number.NaN;
	const durationMs = Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : 0;
	const rule = parseRecurrence(recurrence);

	if (!rule) {
		return [{ startAt, endAt: endAt || null }];
	}

	const rangeEndMs = startMs + daysAhead * 24 * 60 * 60 * 1000;
	const out: { startAt: string; endAt: string | null }[] = [];

	const startWall = wallParts(startMs, TIMEZONE);
	if (!startWall) return [{ startAt, endAt: endAt || null }];

	for (let cursor = startMs; cursor <= rangeEndMs; cursor += 24 * 60 * 60 * 1000) {
		const wall = wallParts(cursor, TIMEZONE);
		if (!wall) continue;
		if (rule === `daily`) {
			// keep every day
		} else if (typeof rule === `number`) {
			if (wall.weekday !== rule) continue;
		} else {
			continue;
		}

		const nextStart = dateToOffsetIso({
			year: wall.year,
			month: wall.month,
			day: wall.day,
			hour: startWall.hour,
			minute: startWall.minute,
			offset: startWall.offset,
		});
		const nextEnd =
			durationMs > 0
				? shiftIsoKeepingOffset({ startIso: nextStart, durationMs, offset: startWall.offset })
				: null;

		out.push({ startAt: nextStart, endAt: nextEnd });
	}

	return out?.length ? out : [{ startAt, endAt: endAt || null }];
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;
		if (arg === `--limit` || arg === `-n`) {
			const raw = argv[++i];
			const value = Number(raw);
			if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --limit: ${raw}`);
			limit = value;
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			const value = Number(arg.slice(`--limit=`.length));
			if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --limit: ${arg}`);
			limit = value;
			continue;
		}
		if (RUNNER_FLAGS.has(arg)) {
			if (arg === `--exclude` || arg === `--log-dir`) i++;
			continue;
		}
		if (arg.startsWith(`-`)) continue;
		files.push(arg);
	}

	return { limit, files };
}

export function parseListing(row: unknown): WobListing | undefined {
	if (!row || typeof row !== `object`) return undefined;
	const record = row as Record<string, unknown>;
	const link = readText(record.link);
	if (!link?.startsWith(`http`)) return undefined;

	const wob = record.wob && typeof record.wob === `object` ? (record.wob as Record<string, unknown>) : undefined;
	const area = wob?.area && typeof wob.area === `object` ? (wob.area as Record<string, unknown>) : undefined;
	const category =
		wob?.category && typeof wob.category === `object` ? (wob.category as Record<string, unknown>) : undefined;
	const image = wob?.image && typeof wob.image === `object` ? (wob.image as Record<string, unknown>) : undefined;
	const large = image?.large && typeof image.large === `object` ? (image.large as Record<string, unknown>) : undefined;
	const mediumLarge =
		image?.medium_large && typeof image.medium_large === `object`
			? (image.medium_large as Record<string, unknown>)
			: undefined;

	return {
		id: typeof record.id === `number` ? record.id : undefined,
		link,
		start: readText(wob?.start),
		end: readText(wob?.end),
		nextStart: readText(wob?.next_start),
		nextEnd: readText(wob?.next_end),
		recurring: readText(wob?.recurring),
		venue: readText(wob?.venue),
		areaName: readText(area?.name),
		categoryName: readText(category?.name),
		priceLabel: readText(wob?.price_label),
		ticketUrl: readText(wob?.ticket_url),
		imageUrl: readText(large?.url) || readText(mediumLarge?.url),
	};
}

function getEventSchema(html: string): EventSchema | undefined {
	const matches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
	for (const match of matches) {
		const raw = match[1];
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			const event = findEventNode(parsed);
			if (event) return event;
		} catch {
			// ignore malformed JSON-LD blocks
		}
	}
	return undefined;
}

function findEventNode(node: unknown): EventSchema | undefined {
	if (!node) return undefined;
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findEventNode(item);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof node !== `object`) return undefined;
	const record = node as Record<string, unknown>;
	const type = record[`@type`];
	if (type === `Event` || (Array.isArray(type) && type.includes(`Event`))) {
		return record as EventSchema;
	}
	if (record[`@graph`]) return findEventNode(record[`@graph`]);
	return undefined;
}

function parseRecurrence(value: string | null | undefined): RecurrenceRule {
	if (!value?.trim()) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === `daily` || normalized === `every day`) return `daily`;
	const weekly = normalized.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
	if (weekly?.[1]) return WEEKDAY_NAMES.indexOf(weekly[1].toLowerCase() as (typeof WEEKDAY_NAMES)[number]);
	return undefined;
}

function occurrenceSourceUrl({
	sourceUrl,
	startAt,
	recurring,
}: {
	sourceUrl: string;
	startAt: string;
	recurring: boolean;
}): string {
	if (!recurring) return sourceUrl;
	const day = startAt.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return sourceUrl;
	const url = new URL(sourceUrl);
	url.searchParams.set(`date`, day);
	return url.toString();
}

async function fillCoordinates(event: ScrapedEvent) {
	if (!event.address?.length) return;
	const apiKey = process.env.GOOGLE_MAPS_API_KEY || ``;
	if (!apiKey) return;
	try {
		const geocoded = await geocodeAddressCached({
			addressLines: event.address,
			apiKey,
		});
		if (!geocoded) return;
		event.latitude = geocoded.lat;
		event.longitude = geocoded.lng;
		event.timezone = geocoded.timezone || TIMEZONE;
	} catch (error) {
		console.error(`Geocoding failed for ${event.sourceUrl}:`, error);
	}
}

function wallParts(ms: number, timeZone: string): WallParts | undefined {
	try {
		const formatter = new Intl.DateTimeFormat(`en-US`, {
			timeZone,
			year: `numeric`,
			month: `2-digit`,
			day: `2-digit`,
			hour: `2-digit`,
			minute: `2-digit`,
			hourCycle: `h23`,
			timeZoneName: `longOffset`,
		});
		const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
		const year = Number(parts.year);
		const month = Number(parts.month);
		const day = Number(parts.day);
		const hour = Number(parts.hour);
		const minute = Number(parts.minute);
		if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;
		const offset = parts.timeZoneName?.match(/[+-]\d{2}:\d{2}/)?.[0] || `+08:00`;
		const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
		return { year, month, day, hour, minute, offset, weekday };
	} catch {
		return undefined;
	}
}

function dateToOffsetIso({
	year,
	month,
	day,
	hour,
	minute,
	offset,
}: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	offset: string;
}): string {
	return `${String(year).padStart(4, `0`)}-${String(month).padStart(2, `0`)}-${String(day).padStart(2, `0`)}T${String(hour).padStart(2, `0`)}:${String(minute).padStart(2, `0`)}:00${offset}`;
}

function shiftIsoKeepingOffset({
	startIso,
	durationMs,
	offset,
}: {
	startIso: string;
	durationMs: number;
	offset: string;
}): string | null {
	const startMs = Date.parse(startIso);
	if (Number.isNaN(startMs)) return null;
	const endMs = startMs + durationMs;
	const wall = wallParts(endMs, TIMEZONE);
	if (!wall) return null;
	return dateToOffsetIso({
		year: wall.year,
		month: wall.month,
		day: wall.day,
		hour: wall.hour,
		minute: wall.minute,
		offset: offset || wall.offset,
	});
}

function normalizeIso(value: unknown): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;
	// Preserve original offset when present; otherwise keep parsed ISO.
	if (/[+-]\d{2}:\d{2}$|Z$/i.test(value.trim())) return value.trim().replace(/Z$/i, `+00:00`);
	return date.toISOString();
}

function preferFullImageUrl(url: string): string {
	return url.replace(/-\d+x\d+(?=\.[a-z]+(?:\?|$))/i, ``);
}

function absoluteUrl(url: string): string {
	if (url.startsWith(`http`)) return url;
	if (url.startsWith(`/`)) return `${SITE_BASE}${url}`;
	return url;
}

function cleanText(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const text = value.replace(/\s+/g, ` `).trim();
	return text || undefined;
}

function normalizeKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/['’]/g, ``)
		.replace(/[^a-z0-9]+/g, ` `)
		.trim()
		.replace(/\s+/g, ` `);
}

function escapeHtml(text: string) {
	return text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`);
}

function readText(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	const text = value.replace(/\s+/g, ` `).trim();
	return text || undefined;
}

if (import.meta.main) {
	try {
		const { limit, files } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length ? await scraper.scrapeHtmlFiles(files) : await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events.slice(0, 3), null, 2));
		console.error(`Sampled ${Math.min(3, events.length)} of ${events.length} events.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

type RecurrenceRule = `daily` | number | undefined;

type WallParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	offset: string;
	weekday: number;
};

type EventSchema = {
	name?: unknown;
	description?: unknown;
	url?: unknown;
	image?: unknown;
	startDate?: unknown;
	endDate?: unknown;
	location?: {
		name?: unknown;
		address?: unknown;
	};
};

type WobListing = {
	id?: number;
	link: string;
	start?: string;
	end?: string;
	nextStart?: string;
	nextEnd?: string;
	recurring?: string;
	venue?: string;
	areaName?: string;
	categoryName?: string;
	priceLabel?: string;
	ticketUrl?: string;
	imageUrl?: string;
};
