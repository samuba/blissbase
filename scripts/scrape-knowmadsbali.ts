/**
 * Scrapes Knowmads Bali family events via the public JSON catalog
 * at `https://knowmadsbali.com/api/events`.
 *
 * - Dated rows → one occurrence from startDate/startTime (+ endDate/endTime).
 * - Rows with only `openingHours` → weekly occurrences for the next 90 days
 *   (whitelist title filter; recurring venue spam otherwise).
 * - If both dated and weekly fields exist, prefer the concrete startDate.
 * - Spans longer than 60 days without weekly hours are skipped (ongoing listings).
 * - Blacklisted titles are dropped; dated rows are not whitelist-gated (listing
 *   still happens later in scrape-websites).
 *
 * Usage:
 *   bun run scripts/scrape-knowmadsbali.ts
 *   bun run scripts/scrape-knowmadsbali.ts --limit 10
 *   bun run scripts/scrape-knowmadsbali.ts <json_file> ...
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	superTrim,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SITE_BASE = `https://knowmadsbali.com`;
const API_URL = `${SITE_BASE}/api/events`;
const SOURCE = `knowmadsbali` as const;
const TIMEZONE = `Asia/Makassar` as const;
const OCCURRENCE_DAYS_AHEAD = 90;
const MAX_SPAN_DAYS = 60;
const GEOCODE_BIAS = [`Bali`, `Indonesia`];
const DAY_KEYS = [`sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`] as const;
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
			`Fetching Knowmads Bali events via ${API_URL}${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let rows: KnowmadsEvent[];
		try {
			rows = await fetchKnowmadsEvents();
		} catch (error) {
			console.error(`Failed to fetch Knowmads Bali events:`, error);
			return [];
		}
		console.error(`Loaded ${rows.length} catalog rows. Mapping...`);

		const events: ScrapedEvent[] = [];
		const now = Date.now() - 6 * 60 * 60 * 1000;

		for (const row of rows) {
			if (resolvedLimit != null && events.length >= resolvedLimit) break;
			try {
				const mapped = mapKnowmadsRowSync(row);
				for (const event of mapped) {
					if (resolvedLimit != null && events.length >= resolvedLimit) break;
					if (Date.parse(event.startAt) < now) continue;
					await fillCoordinates(event);
					events.push(event);
				}
			} catch (error) {
				console.error(`Failed to process ${row?.slug ?? row?.id}:`, error);
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
				const raw = await Bun.file(filePath).text();
				const rows = parseKnowmadsPayload(raw);
				for (const row of rows) {
					try {
						events.push(...(await mapKnowmadsRow(row)));
					} catch (error) {
						console.error(`Failed to process item from ${filePath}:`, error);
					}
				}
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, _url: string): Promise<ScrapedEvent | undefined> {
		try {
			const rows = parseKnowmadsPayload(html);
			if (!rows?.length) return undefined;
			const mapped = await mapKnowmadsRow(rows[0]);
			return mapped[0];
		} catch (error) {
			console.error(`Error extracting event data:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName(firstRow(html));
	}
	extractStartAt(html: string): string | undefined {
		const row = firstRow(html);
		if (!row) return undefined;
		return mapKnowmadsRowSync(row)[0]?.startAt;
	}
	extractEndAt(html: string): string | undefined {
		const row = firstRow(html);
		if (!row) return undefined;
		return mapKnowmadsRowSync(row)[0]?.endAt ?? undefined;
	}
	extractAddress(html: string): string[] | undefined {
		return getAddress(firstRow(html));
	}
	extractPrice(html: string): string | undefined {
		return getPrice(firstRow(html));
	}
	extractDescription(html: string): string | undefined {
		return getDescription(firstRow(html));
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls(firstRow(html));
	}
	extractHost(html: string): string | undefined {
		return getHost(firstRow(html));
	}
	extractHostLink(html: string): string | undefined {
		return getHostLink(firstRow(html));
	}
	extractTags(html: string): string[] | undefined {
		return getTags(firstRow(html));
	}
}

export async function mapKnowmadsRow(row: KnowmadsEvent | undefined): Promise<ScrapedEvent[]> {
	const mapped = mapKnowmadsRowSync(row);
	for (const event of mapped) {
		await fillCoordinates(event);
	}
	return mapped;
}

export function mapKnowmadsRowSync(row: KnowmadsEvent | undefined): ScrapedEvent[] {
	if (!row || row.isPublished === false) return [];

	const name = getName(row);
	const sourceUrl = getSourceUrl(row);
	if (!name || !sourceUrl) {
		console.error(`Skipping ${row.slug ?? row.id} due to missing name or sourceUrl.`);
		return [];
	}

	if (matchesBlackListWords(name)) {
		console.error(`Skipping ${sourceUrl} (title matched blacklist)`);
		return [];
	}

	// Prefer concrete dates when present; live catalog currently never sets both.
	if (parseDateOnly(row.startDate)) {
		const dated = mapDatedOccurrence({ row, name, sourceUrl });
		return dated ? [dated] : [];
	}

	const weeklySlots = getWeeklySlots(row);
	if (weeklySlots?.length) {
		// Recurring listings are mostly permanent venues; only expand conscious-ish titles.
		if (!matchesWhiteListWords(name)) {
			console.error(`Skipping weekly ${sourceUrl} (title failed whitelist)`);
			return [];
		}
		return expandWeeklyOccurrences({ row, name, sourceUrl, weeklySlots });
	}

	console.error(`Skipping ${sourceUrl}: no startDate and no openingHours`);
	return [];
}

export async function fetchKnowmadsEvents(): Promise<KnowmadsEvent[]> {
	const body = (await customFetch(API_URL, { returnType: `json` })) as unknown;
	if (!Array.isArray(body)) {
		throw new Error(`Knowmads /api/events did not return an array`);
	}
	return body as KnowmadsEvent[];
}

export function parseKnowmadsPayload(raw: string): KnowmadsEvent[] {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) return parsed as KnowmadsEvent[];
		if (parsed && typeof parsed === `object`) {
			const obj = parsed as { events?: unknown; item?: unknown };
			if (Array.isArray(obj.events)) return obj.events as KnowmadsEvent[];
			if (obj.item && typeof obj.item === `object`) return [obj.item as KnowmadsEvent];
			if (`slug` in (parsed as object) || `title` in (parsed as object)) {
				return [parsed as KnowmadsEvent];
			}
		}
	} catch {
		return [];
	}
	return [];
}

export function getName(row: KnowmadsEvent | undefined): string | undefined {
	if (!row) return undefined;
	const title = superTrim(row.title);
	return title || undefined;
}

export function getDescription(row: KnowmadsEvent | undefined): string | undefined {
	if (!row) return undefined;
	const raw = row.description?.trim();
	if (!raw) return undefined;

	if (raw.includes(`<`) && raw.includes(`>`)) {
		return cleanProseHtml(raw) || undefined;
	}

	const html = raw
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join(``);
	return cleanProseHtml(html) || undefined;
}

export function getAddress(row: KnowmadsEvent | undefined): string[] {
	if (!row) return [];
	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined | null) => {
		const text = superTrim(raw ?? undefined);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	push(row.address);
	const area = superTrim(row.area ?? undefined);
	if (area && !lines.some((line) => line.toLowerCase().includes(area.toLowerCase()))) {
		push(area);
	}
	if (!lines?.length) push(`Bali`);
	else if (!lines.some((line) => /bali/i.test(line))) push(`Bali`);
	return lines;
}

export function getPrice(row: KnowmadsEvent | undefined): string | undefined {
	if (!row) return undefined;
	const price = superTrim(row.priceInfo);
	if (!price) return undefined;
	if (/^paid$/i.test(price)) return undefined;
	if (/^(free|gratis|kostenlos)\b/i.test(price)) return `Free`;
	return price;
}

export function getImageUrls(row: KnowmadsEvent | undefined): string[] {
	if (!row?.imageUrl) return [];
	const absolute = absoluteUrl(row.imageUrl);
	return absolute ? [absolute] : [];
}

export function getHost(row: KnowmadsEvent | undefined): string | undefined {
	void row;
	return `Knowmads Bali`;
}

export function getHostLink(row: KnowmadsEvent | undefined): string | undefined {
	void row;
	return SITE_BASE;
}

export function getContact(row: KnowmadsEvent | undefined): string[] {
	if (!row) return [];
	const contacts: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined | null) => {
		const value = superTrim(raw ?? undefined);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	if (row.contactEmail?.trim()) add(row.contactEmail.trim());
	if (row.instagramUrl?.trim()) add(row.instagramUrl.trim());
	const external = row.externalUrl?.trim();
	if (external?.startsWith(`http`)) add(external);
	return contacts;
}

export function getTags(row: KnowmadsEvent | undefined): string[] {
	if (!row) return [];
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined | null) => {
		const value = superTrim(raw ?? undefined);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(value);
	};

	add(row.category);
	if (row.withKids) add(`kids`);
	if (row.featured) add(`featured`);
	if (row.isMajor) add(`major`);
	add(row.area);
	return tags;
}

export function getSourceUrl(row: KnowmadsEvent | undefined): string | undefined {
	if (!row?.slug?.trim()) return undefined;
	return `${SITE_BASE}/en/events/${row.slug.trim()}`;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (RUNNER_FLAGS.has(arg)) {
			if (arg === `--exclude` || arg === `--log-dir`) i++;
			continue;
		}
		if (arg === `--limit` || arg === `-n`) {
			const value = Number(argv[++i]);
			if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --limit: ${argv[i]}`);
			limit = value;
			continue;
		}
		const inline = arg.match(/^--limit=(\d+)$/);
		if (inline) {
			limit = Number(inline[1]);
			if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${arg}`);
			continue;
		}
		if (arg.startsWith(`-`)) continue;
		files.push(arg);
	}

	return { limit, files };
}

function mapDatedOccurrence({
	row,
	name,
	sourceUrl,
}: {
	row: KnowmadsEvent;
	name: string;
	sourceUrl: string;
}): ScrapedEvent | undefined {
	const startDate = parseDateOnly(row.startDate);
	if (!startDate) return undefined;

	const endDate = parseDateOnly(row.endDate);
	if (endDate) {
		const spanDays = daysBetween(startDate, endDate);
		if (spanDays > MAX_SPAN_DAYS) {
			console.error(`Skipping ${sourceUrl}: span ${spanDays}d exceeds ${MAX_SPAN_DAYS}d`);
			return undefined;
		}
	}

	const startTime = parseTime(row.startTime) ?? { hour: 0, minute: 0 };
	const startAt = dateToIsoStr(
		startDate.year,
		startDate.month,
		startDate.day,
		startTime.hour,
		startTime.minute,
		TIMEZONE,
		false,
	);

	const endAt = buildDatedEndAt({ row, startDate, startTime, endDate });

	return {
		name,
		startAt,
		endAt,
		timezone: TIMEZONE,
		address: getAddress(row),
		price: getPrice(row),
		priceIsHtml: false,
		description: getDescription(row),
		imageUrls: getImageUrls(row),
		host: getHost(row),
		hostLink: getHostLink(row),
		contact: getContact(row),
		latitude: null,
		longitude: null,
		tags: getTags(row),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

function expandWeeklyOccurrences({
	row,
	name,
	sourceUrl,
	weeklySlots,
}: {
	row: KnowmadsEvent;
	name: string;
	sourceUrl: string;
	weeklySlots: WeeklySlot[];
}): ScrapedEvent[] {
	const rangeStart = startOfLocalDay(new Date(), TIMEZONE);
	const rangeEnd = addDays(rangeStart, OCCURRENCE_DAYS_AHEAD);
	const windowStart = parseDateOnly(row.startDate);
	const windowEnd = parseDateOnly(row.endDate);
	const events: ScrapedEvent[] = [];

	for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
		const weekday = cursor.getDay();
		const slot = weeklySlots.find((entry) => entry.weekday === weekday);
		if (!slot) continue;

		const y = cursor.getFullYear();
		const m = cursor.getMonth() + 1;
		const d = cursor.getDate();
		if (windowStart && compareYmd({ year: y, month: m, day: d }, windowStart) < 0) continue;
		if (windowEnd && compareYmd({ year: y, month: m, day: d }, windowEnd) > 0) continue;

		const startAt = dateToIsoStr(y, m, d, slot.open.hour, slot.open.minute, TIMEZONE, false);
		let endDay = { year: y, month: m, day: d };
		let endHour = slot.close.hour;
		let endMinute = slot.close.minute;
		if (
			endHour < slot.open.hour ||
			(endHour === slot.open.hour && endMinute <= slot.open.minute)
		) {
			const next = addDays(cursor, 1);
			endDay = { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
		}
		const endAt = dateToIsoStr(
			endDay.year,
			endDay.month,
			endDay.day,
			endHour,
			endMinute,
			TIMEZONE,
			false,
		);

		const occurrenceUrl = `${sourceUrl}?date=${String(y).padStart(4, `0`)}-${String(m).padStart(2, `0`)}-${String(d).padStart(2, `0`)}`;
		events.push({
			name,
			startAt,
			endAt,
			timezone: TIMEZONE,
			address: getAddress(row),
			price: getPrice(row),
			priceIsHtml: false,
			description: getDescription(row),
			imageUrls: getImageUrls(row),
			host: getHost(row),
			hostLink: getHostLink(row),
			contact: getContact(row),
			latitude: null,
			longitude: null,
			tags: getTags(row),
			sourceUrl: occurrenceUrl,
			source: SOURCE,
		} satisfies ScrapedEvent);
	}

	return events;
}

function buildDatedEndAt({
	row,
	startDate,
	startTime,
	endDate,
}: {
	row: KnowmadsEvent;
	startDate: Ymd;
	startTime: Clock;
	endDate: Ymd | undefined;
}): string | undefined {
	const endTime = parseTime(row.endTime);
	if (!endDate && !endTime) return undefined;

	const day = endDate ?? startDate;
	if (!endTime) {
		return dateToIsoStr(day.year, day.month, day.day, 23, 59, TIMEZONE, false);
	}

	let endDay = day;
	const sameCalendarDay = !endDate || compareYmd(endDate, startDate) === 0;
	if (
		sameCalendarDay &&
		(endTime.hour < startTime.hour ||
			(endTime.hour === startTime.hour && endTime.minute <= startTime.minute))
	) {
		const next = addDays(new Date(startDate.year, startDate.month - 1, startDate.day), 1);
		endDay = { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
	}

	return dateToIsoStr(endDay.year, endDay.month, endDay.day, endTime.hour, endTime.minute, TIMEZONE, false);
}

function getWeeklySlots(row: KnowmadsEvent): WeeklySlot[] | undefined {
	const hours = row.openingHours;
	if (!hours || typeof hours !== `object`) return undefined;

	const slots: WeeklySlot[] = [];
	for (let weekday = 0; weekday < DAY_KEYS.length; weekday++) {
		const key = DAY_KEYS[weekday];
		const entry = hours[key];
		if (!entry?.open) continue;
		const open = parseTime(entry.open);
		if (!open) continue;
		const close = parseTime(entry.close) ?? { hour: (open.hour + 2) % 24, minute: open.minute };
		slots.push({ weekday, open, close });
	}
	return slots?.length ? slots : undefined;
}

function parseDateOnly(value: string | null | undefined): Ymd | undefined {
	if (!value) return undefined;
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	return { year, month, day };
}

function parseTime(value: string | null | undefined): Clock | undefined {
	if (!value) return undefined;
	const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	return { hour, minute };
}

function daysBetween(start: Ymd, end: Ymd) {
	const a = Date.UTC(start.year, start.month - 1, start.day);
	const b = Date.UTC(end.year, end.month - 1, end.day);
	return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function compareYmd(a: Ymd, b: Ymd) {
	return a.year - b.year || a.month - b.month || a.day - b.day;
}

function addDays(date: Date, days: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function startOfLocalDay(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(date);
	const year = Number(parts.find((p) => p.type === `year`)?.value);
	const month = Number(parts.find((p) => p.type === `month`)?.value);
	const day = Number(parts.find((p) => p.type === `day`)?.value);
	return new Date(year, month - 1, day);
}

function absoluteUrl(raw: string): string | undefined {
	const value = raw.trim();
	if (!value) return undefined;
	if (value.startsWith(`http://`) || value.startsWith(`https://`)) return value;
	if (value.startsWith(`//`)) return `https:${value}`;
	if (value.startsWith(`/`)) return `${SITE_BASE}${value}`;
	return undefined;
}

function escapeHtml(text: string) {
	return text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`);
}

function firstRow(html: string): KnowmadsEvent | undefined {
	return parseKnowmadsPayload(html)[0];
}

async function fillCoordinates(event: ScrapedEvent) {
	if (!event.address?.length) return;
	const apiKey = process.env.GOOGLE_MAPS_API_KEY || ``;
	if (!apiKey) return;
	try {
		const geocoded = await geocodeAddressCached({
			addressLines: [...event.address, ...GEOCODE_BIAS],
			apiKey,
		});
		if (!geocoded) return;
		event.latitude = geocoded.lat;
		event.longitude = geocoded.lng;
		event.timezone = geocoded.timezone ?? event.timezone;
	} catch (error) {
		console.error(`Geocoding failed for ${event.sourceUrl}:`, error);
	}
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
		console.error("Unhandled error in main execution:", error);
		process.exit(1);
	}
}

type Clock = { hour: number; minute: number };
type Ymd = { year: number; month: number; day: number };
type WeeklySlot = { weekday: number; open: Clock; close: Clock };

type OpeningHours = Partial<
	Record<(typeof DAY_KEYS)[number], { open?: string | null; close?: string | null } | null>
>;

type KnowmadsEvent = {
	id?: string;
	title?: string | null;
	description?: string | null;
	category?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	startTime?: string | null;
	endTime?: string | null;
	imageUrl?: string | null;
	isPublished?: boolean | null;
	slug?: string | null;
	featured?: boolean | null;
	isMajor?: boolean | null;
	withKids?: boolean | null;
	priceInfo?: string | null;
	area?: string | null;
	address?: string | null;
	externalUrl?: string | null;
	contactEmail?: string | null;
	instagramUrl?: string | null;
	openingHours?: OpeningHours | null;
};
