/**
 * Scrapes BaliFolio events via their public JSON API (`/api/events`), then
 * optionally enriches venue coords/contact from `/api/directory/{id}`.
 *
 * Usage:
 *   bun run scripts/scrape-balifolio.ts
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	REQUEST_DELAY_MS,
	sleep,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SITE_BASE = `https://balifolio.com`;
const EVENTS_API = `${SITE_BASE}/api/events`;
const DIRECTORY_API = `${SITE_BASE}/api/directory`;
const SOURCE = `balifolio` as const;
const TIMEZONE = `Asia/Makassar` as const;
const PAGE_SIZE = 100;
const OCCURRENCE_DAYS_AHEAD = 90;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		console.error(`Fetching BaliFolio events via ${EVENTS_API}...`);
		const rows = await fetchAllEvents();
		console.error(`Fetched ${rows.length} published events.`);

		const rangeStart = startOfLocalDay(new Date(), TIMEZONE);
		const rangeEnd = addDays(rangeStart, OCCURRENCE_DAYS_AHEAD);
		const upcoming = rows.filter((row) => isWithinRange({ row, rangeStart, rangeEnd }));
		console.error(`  ${upcoming.length} with start date in the next ${OCCURRENCE_DAYS_AHEAD} days.`);

		const candidates = upcoming.filter((row) => {
			const name = getName(row);
			if (!name) return false;
			if (matchesBlackListWords(name) || !matchesWhiteListWords(name)) return false;
			return true;
		});
		console.error(`  ${candidates.length} match whitelist/blacklist.`);

		const venueCache = new Map<number, BaliFolioVenue | null>();
		const scraped: ScrapedEvent[] = [];
		const seen = new Set<string>();

		for (const row of candidates) {
			try {
				const venue = await resolveVenue({ row, venueCache });
				const event = mapBaliFolioEvent({ row, venue });
				if (!event) continue;
				if (seen.has(event.sourceUrl)) continue;
				seen.add(event.sourceUrl);
				scraped.push(event);
			} catch (error) {
				console.error(`Failed to process BaliFolio event ${row.id} (${row.title}):`, error);
			}
		}

		scraped.sort((a, b) => a.startAt.localeCompare(b.startAt));
		console.error(`--- Scraping finished. Total events collected: ${scraped.length} ---`);
		return scraped;
	}

	async scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		throw new Error(`Method not implemented.` + html + url);
	}

	extractName(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractStartAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractEndAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractAddress(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractPrice(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractDescription(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractImageUrls(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHost(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHostLink(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractTags(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
}

export function mapBaliFolioEvent({
	row,
	venue,
}: {
	row: BaliFolioEvent;
	venue?: BaliFolioVenue | null;
}): ScrapedEvent | undefined {
	const name = getName(row);
	const startAt = getStartAt(row);
	const sourceUrl = getSourceUrl(row);
	if (!name || !startAt || !sourceUrl) return undefined;

	return {
		name,
		startAt,
		endAt: getEndAt(row),
		timezone: TIMEZONE,
		address: getAddress({ row, venue }),
		price: getPrice(row),
		priceIsHtml: false,
		description: getDescription(row),
		imageUrls: getImageUrls(row),
		host: getHost({ row, venue }),
		hostLink: getHostLink({ row, venue }),
		contact: getContact({ row, venue }),
		latitude: getLatitude(venue),
		longitude: getLongitude(venue),
		tags: getTags(row),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

function getName(row: BaliFolioEvent): string | undefined {
	const title = row.title?.replace(/\s+/g, ` `).trim();
	return title || undefined;
}

function getStartAt(row: BaliFolioEvent): string | undefined {
	const day = parseDateOnly(row.date);
	if (!day) return undefined;
	const time = parseTime(row.time) ?? { hour: 0, minute: 0 };
	return dateToIsoStr(day.year, day.month, day.day, time.hour, time.minute, TIMEZONE, false);
}

function getEndAt(row: BaliFolioEvent): string | undefined {
	const day = parseDateOnly(row.date);
	if (!day) return undefined;

	const startTime = parseTime(row.time);
	const endTime = parseTime(row.endTime);
	if (!endTime) {
		// Without endTime, endDate is often a series/availability window (weeks/months),
		// not the occurrence end. Only trust short one-off spans (e.g. festivals).
		return endAtFromEndDateOnly({ row, day });
	}

	let endYear = day.year;
	let endMonth = day.month;
	let endDayNum = day.day;
	let endHour = endTime.hour;
	let endMinute = endTime.minute;

	if (startTime) {
		const endsBeforeStart =
			endHour < startTime.hour || (endHour === startTime.hour && endMinute < startTime.minute);
		if (endsBeforeStart) {
			const rolled = addCalendarDays({ year: day.year, month: day.month, day: day.day }, 1);
			endYear = rolled.year;
			endMonth = rolled.month;
			endDayNum = rolled.day;
		}
	}

	return dateToIsoStr(endYear, endMonth, endDayNum, endHour, endMinute, TIMEZONE, false);
}

/** Max calendar-day span for trusting endDate without endTime as a real occurrence end. */
const MAX_END_DATE_ONLY_SPAN_DAYS = 7;

function endAtFromEndDateOnly({
	row,
	day,
}: {
	row: BaliFolioEvent;
	day: { year: number; month: number; day: number };
}): string | undefined {
	const endDay = parseDateOnly(row.endDate);
	if (!endDay) return undefined;

	const frequency = row.frequency?.trim().toLowerCase();
	if (frequency === `weekly` || frequency === `monthly` || frequency === `yearly`) {
		return undefined;
	}

	const spanDays = calendarDayDiff({ from: day, to: endDay });
	if (spanDays == null || spanDays <= 0) return undefined;
	if (spanDays > MAX_END_DATE_ONLY_SPAN_DAYS) return undefined;

	return dateToIsoStr(endDay.year, endDay.month, endDay.day, 23, 59, TIMEZONE, false);
}

function calendarDayDiff({
	from,
	to,
}: {
	from: { year: number; month: number; day: number };
	to: { year: number; month: number; day: number };
}) {
	const fromMs = Date.UTC(from.year, from.month - 1, from.day);
	const toMs = Date.UTC(to.year, to.month - 1, to.day);
	return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function getAddress({
	row,
	venue,
}: {
	row: BaliFolioEvent;
	venue?: BaliFolioVenue | null;
}): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();

	const push = (value: string | null | undefined) => {
		const line = value?.replace(/\s+/g, ` `).trim();
		if (!line) return;
		const key = line.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(line);
	};

	push(venue?.name);
	push(venue?.address);
	push(row.venue);
	push(venue?.area || row.area);
	if (!lines?.length) push(`Bali`);
	else if (!lines.some((line) => /bali/i.test(line))) push(`Bali`);
	return lines;
}

function getPrice(row: BaliFolioEvent): string | undefined {
	if (typeof row.price !== `number` || !Number.isFinite(row.price)) return undefined;
	if (row.price <= 0) return `Free`;
	return `IDR ${Math.round(row.price).toLocaleString(`de-DE`)}`;
}

function getDescription(row: BaliFolioEvent): string | undefined {
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

function getImageUrls(row: BaliFolioEvent): string[] {
	const raw = row.heroImageUrl?.trim();
	if (!raw) return [];
	const url = absoluteUrl(raw);
	return url ? [url] : [];
}

function getHost({
	row,
	venue,
}: {
	row: BaliFolioEvent;
	venue?: BaliFolioVenue | null;
}): string | undefined {
	const venueName = venue?.name?.trim() || row.venue?.trim();
	return venueName || undefined;
}

function getHostLink({
	row,
	venue,
}: {
	row: BaliFolioEvent;
	venue?: BaliFolioVenue | null;
}): string | undefined {
	const website = venue?.website?.trim();
	if (website?.startsWith(`http`)) return website;

	const booking = row.bookingUrl?.trim();
	if (booking?.startsWith(`http`)) return booking;

	const external = row.sourceUrl?.trim();
	if (external?.startsWith(`http`)) return external;

	if (venue?.slug?.trim()) return `${SITE_BASE}/directory/${venue.slug.trim()}`;
	return undefined;
}

function getContact({
	row,
	venue,
}: {
	row: BaliFolioEvent;
	venue?: BaliFolioVenue | null;
}): string[] {
	const contact: string[] = [];
	const push = (value: string | null | undefined) => {
		const item = value?.trim();
		if (!item) return;
		if (contact.includes(item)) return;
		contact.push(item);
	};

	push(toWhatsappUrl(venue?.whatsapp));
	const phone = venue?.phone?.trim();
	if (phone) push(phone);
	push(toInstagramUrl(venue?.instagram));
	const email = venue?.email?.trim();
	if (email?.includes(`@`)) push(email);
	const booking = row.bookingUrl?.trim();
	if (booking?.startsWith(`http`)) push(booking);
	const external = row.sourceUrl?.trim();
	if (external?.startsWith(`http`)) push(external);
	const website = venue?.website?.trim();
	if (website?.startsWith(`http`)) push(website);
	return contact;
}

function getLatitude(venue?: BaliFolioVenue | null): number | undefined {
	if (typeof venue?.lat !== `number` || !Number.isFinite(venue.lat)) return undefined;
	return venue.lat;
}

function getLongitude(venue?: BaliFolioVenue | null): number | undefined {
	if (typeof venue?.lng !== `number` || !Number.isFinite(venue.lng)) return undefined;
	return venue.lng;
}

function getTags(row: BaliFolioEvent): string[] {
	const tags: string[] = [];
	const category = row.category?.trim();
	if (category) tags.push(category);
	const frequency = row.frequency?.trim();
	if (frequency && frequency !== `one-off`) tags.push(frequency);
	return tags;
}

function getSourceUrl(row: BaliFolioEvent): string | undefined {
	const slug = row.slug?.trim();
	if (slug) return `${SITE_BASE}/events/${slug}`;
	if (typeof row.id === `number`) return `${SITE_BASE}/events/${row.id}`;
	return undefined;
}

async function fetchAllEvents(): Promise<BaliFolioEvent[]> {
	const rows: BaliFolioEvent[] = [];
	let page = 1;

	while (true) {
		const url = new URL(EVENTS_API);
		url.searchParams.set(`limit`, String(PAGE_SIZE));
		url.searchParams.set(`page`, String(page));

		const body = (await customFetch(url.toString(), { returnType: `json` })) as BaliFolioEventsResponse;
		if (!Array.isArray(body?.data)) {
			throw new Error(`BaliFolio events response is missing a data array`);
		}

		for (const row of body.data) {
			if (row?.status && row.status !== `PUBLISHED`) continue;
			if (row?.autoHidden) continue;
			rows.push(row);
		}

		console.error(`  page ${page}/${body.pagination?.totalPages ?? `?`} — ${rows.length} rows so far`);
		const totalPages = body.pagination?.totalPages ?? page;
		if (page >= totalPages || !body.data.length) break;
		page += 1;
		await sleep(REQUEST_DELAY_MS);
	}

	return rows;
}

async function resolveVenue({
	row,
	venueCache,
}: {
	row: BaliFolioEvent;
	venueCache: Map<number, BaliFolioVenue | null>;
}): Promise<BaliFolioVenue | null> {
	const venueRef = row.venueRef;
	if (typeof venueRef !== `number`) return null;
	if (venueCache.has(venueRef)) return venueCache.get(venueRef) ?? null;

	try {
		await sleep(REQUEST_DELAY_MS);
		const venue = (await customFetch(`${DIRECTORY_API}/${venueRef}`, {
			returnType: `json`,
		})) as BaliFolioVenue;
		venueCache.set(venueRef, venue ?? null);
		return venue ?? null;
	} catch (error) {
		console.error(`Failed to fetch BaliFolio directory ${venueRef}:`, error);
		venueCache.set(venueRef, null);
		return null;
	}
}

function isWithinRange({
	row,
	rangeStart,
	rangeEnd,
}: {
	row: BaliFolioEvent;
	rangeStart: Date;
	rangeEnd: Date;
}) {
	const day = parseDateOnly(row.date);
	if (!day) return false;
	const start = new Date(day.year, day.month - 1, day.day);
	if (start < rangeStart) return false;
	if (start > rangeEnd) return false;
	return true;
}

function parseDateOnly(value: string | null | undefined) {
	if (!value) return undefined;
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	return { year, month, day };
}

function parseTime(value: string | null | undefined) {
	if (!value) return undefined;
	const match = value.match(/^(\d{1,2}):(\d{2})/);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return undefined;
	return { hour, minute };
}

function absoluteUrl(value: string) {
	if (value.startsWith(`http://`) || value.startsWith(`https://`)) return value;
	if (value.startsWith(`/`)) return `${SITE_BASE}${value}`;
	return undefined;
}

function addDays(date: Date, days: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function addCalendarDays(day: { year: number; month: number; day: number }, days: number) {
	const date = new Date(day.year, day.month - 1, day.day);
	date.setDate(date.getDate() + days);
	return {
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
	};
}

function startOfLocalDay(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(date);
	const year = Number(parts.find((part) => part.type === `year`)?.value);
	const month = Number(parts.find((part) => part.type === `month`)?.value);
	const day = Number(parts.find((part) => part.type === `day`)?.value);
	return new Date(year, month - 1, day);
}

function toInstagramUrl(value: string | null | undefined) {
	const raw = value?.trim();
	if (!raw) return undefined;
	if (raw.startsWith(`http`)) return raw;
	const username = raw.replace(/^@/, ``).replace(/^instagram\.com\//i, ``).replace(/\/$/, ``);
	if (!username) return undefined;
	return `https://instagram.com/${username}`;
}

function toWhatsappUrl(value: string | null | undefined) {
	const raw = value?.trim();
	if (!raw) return undefined;
	if (/^https?:\/\/(www\.)?(wa\.me|api\.whatsapp\.com)\//i.test(raw)) return raw;
	const digits = raw.replace(/\D/g, ``);
	if (!digits) return undefined;
	return `https://wa.me/${digits}`;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite();
		console.log(JSON.stringify(events.slice(0, 5), null, 2));
		console.error(`Sampled ${Math.min(5, events.length)} of ${events.length} events.`);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}

type BaliFolioEvent = {
	id: number;
	title: string | null;
	slug: string | null;
	category: string | null;
	area: string | null;
	date: string | null;
	time: string | null;
	endDate: string | null;
	endTime: string | null;
	venue: string | null;
	venueRef: number | null;
	price: number | null;
	frequency: string | null;
	description: string | null;
	heroImageUrl: string | null;
	sourceUrl: string | null;
	bookingUrl: string | null;
	status: string | null;
	autoHidden: boolean | null;
};

type BaliFolioVenue = {
	id: number;
	name: string | null;
	slug: string | null;
	address: string | null;
	area: string | null;
	lat: number | null;
	lng: number | null;
	website: string | null;
	phone: string | null;
	whatsapp: string | null;
	instagram: string | null;
	email: string | null;
};

type BaliFolioEventsResponse = {
	data: BaliFolioEvent[];
	pagination?: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
};
