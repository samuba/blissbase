/**
 * Scrapes Bali.com events via the public Supabase PostgREST API used by
 * app.bali.com (`events` + joined `places`). The WordPress page at
 * bali.com/events-calendar only embeds that app.
 *
 * Usage:
 *   bun run scripts/scrape-balicom.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SUPABASE_URL = `https://wbwgwytdqubtrdxfbjrr.supabase.co`;
const SUPABASE_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indid2d3eXRkcXVidHJkeGZianJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1NjIyMzAsImV4cCI6MjA2NzEzODIzMH0.NwPXF8UYbOqhjxUka0kzb47IPgx146_7V7Ats4IUDUs`;
const SITE_BASE = `https://app.bali.com`;
const TIMEZONE = `Asia/Makassar`;
const PAGE_SIZE = 100;
const OCCURRENCE_DAYS_AHEAD = 90;

const EVENT_COLUMNS = [
	`id`,
	`event_status`,
	`event_name`,
	`event_slug`,
	`event_category`,
	`event_area`,
	`event_date`,
	`event_fullday`,
	`event_time_begin`,
	`event_time_end`,
	`event_descr`,
	`event_image_url`,
	`venue_place_id`,
	`event_booking_url`,
	`event_info_url`,
	`event_gmap_url`,
	`event_price`,
	`event_dates`,
	`event_recurrence_type`,
	`event_last_date`,
] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];

		console.error(`Fetching Bali.com events via PostgREST...`);
		await this.assertExpectedSchema();

		const rangeStart = startOfLocalDay(new Date(), TIMEZONE);
		const rangeEnd = addDays(rangeStart, OCCURRENCE_DAYS_AHEAD);
		const rows = await this.fetchAllEvents({ rangeStart, rangeEnd });
		console.error(`Fetched ${rows.length} active upcoming events.`);

		for (const row of rows) {
			try {
				const events = this.rowToEvents({ row, rangeStart, rangeEnd });
				allEvents.push(...events);
			} catch (error) {
				console.error(`Failed to process event ${row.id} (${row.event_name}):`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
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

	private async assertExpectedSchema() {
		const params = new URLSearchParams({
			select: `${EVENT_COLUMNS.join(`,`)},places(*)`,
			limit: `0`,
		});
		const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
			headers: supabaseHeaders(),
		});
		if (!res.ok) {
			throw new Error(
				`Bali.com schema check failed for events+places: ${res.status} ${await res.text()}`,
			);
		}
		console.error(`Schema check passed for events and places.`);
	}

	private async fetchAllEvents(args: {
		rangeStart: Date;
		rangeEnd: Date;
	}): Promise<BaliComEventRow[]> {
		const { rangeStart, rangeEnd } = args;
		const rows: BaliComEventRow[] = [];
		let offset = 0;
		const from = formatDateOnly(rangeStart);
		const to = formatDateOnly(rangeEnd);

		while (true) {
			const params = new URLSearchParams({
				select: `${EVENT_COLUMNS.join(`,`)},places(*)`,
				event_status: `eq.active`,
				or: `(and(event_date.gte.${from},event_date.lte.${to}),and(event_last_date.gte.${from},event_date.lte.${to}))`,
				order: `event_date.asc`,
				limit: String(PAGE_SIZE),
				offset: String(offset),
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
				headers: supabaseHeaders(),
			});
			if (!res.ok) throw new Error(`Events query failed: ${res.status} ${await res.text()}`);

			const page = (await res.json()) as BaliComEventRow[];
			rows.push(...page);
			console.error(`  events offset ${offset} — ${rows.length} rows so far`);

			if (page.length < PAGE_SIZE) break;
			offset += PAGE_SIZE;
			await sleep(100);
		}

		return rows;
	}

	private rowToEvents(args: {
		row: BaliComEventRow;
		rangeStart: Date;
		rangeEnd: Date;
	}): ScrapedEvent[] {
		const { row, rangeStart, rangeEnd } = args;

		const name = getName(row);
		if (!name) return [];
		if (matchesBlackListWords(name) || !matchesWhiteListWords(name)) {
			console.error(`Skipping ${name} (title failed whitelist/blacklist filter)`);
			return [];
		}

		const occurrenceDates = getOccurrenceDates({ row, rangeStart, rangeEnd });
		if (!occurrenceDates?.length) return [];

		const description = getDescription(row);
		const address = getAddress(row);
		const price = getPrice(row);
		const imageUrls = getImageUrls(row);
		const host = getHost(row);
		const hostLink = getHostLink(row);
		const tags = getTags(row);
		const contact = getContact(row);
		const latitude = row.places?.place_lat ?? undefined;
		const longitude = row.places?.place_long ?? undefined;

		const events: ScrapedEvent[] = [];
		for (const occurrenceDate of occurrenceDates) {
			try {
				const startAt = getStartAt({ row, occurrenceDate });
				if (!startAt) continue;
				const endAt = getEndAt({ row, occurrenceDate });

				events.push({
					name,
					description,
					imageUrls,
					startAt,
					endAt,
					address,
					price,
					priceIsHtml: false,
					host,
					hostLink,
					contact,
					latitude,
					longitude,
					timezone: TIMEZONE,
					tags,
					sourceUrl: getSourceUrl(row),
					source: `balicom`,
				} satisfies ScrapedEvent);
			} catch (error) {
				console.error(`Failed to map occurrence for ${row.id} (${row.event_name}):`, error);
			}
		}
		return events;
	}
}

function getName(row: BaliComEventRow): string | undefined {
	const name = row.event_name?.replace(/\s+/g, ` `).trim();
	if (!name) return undefined;
	return name;
}

function getDescription(row: BaliComEventRow): string | undefined {
	const raw = row.event_descr?.trim();
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

function getAddress(row: BaliComEventRow): string[] {
	const lines: string[] = [];
	const placeName = row.places?.place_name?.trim();
	const placeArea = row.places?.place_area?.trim();
	const eventArea = row.event_area?.trim();

	if (placeName) lines.push(placeName);
	if (placeArea && !lines.some((line) => line.toLowerCase() === placeArea.toLowerCase())) {
		lines.push(placeArea);
	} else if (
		eventArea &&
		!lines.some((line) => line.toLowerCase() === eventArea.toLowerCase())
	) {
		lines.push(eventArea);
	}
	if (!lines.some((line) => /^bali$/i.test(line))) lines.push(`Bali`);
	return lines;
}

function getPrice(row: BaliComEventRow): string | undefined {
	const price = row.event_price?.trim();
	if (!price) return undefined;
	if (/^free$/i.test(price)) return `Free`;
	return price;
}

function getImageUrls(row: BaliComEventRow): string[] {
	const urls: string[] = [];
	const hero = row.event_image_url?.trim();
	if (hero?.startsWith(`http`)) urls.push(hero);

	const placeImage =
		row.places?.place_image_url?.trim() || row.places?.place_image_url_wp?.trim();
	if (placeImage?.startsWith(`http`) && !urls.includes(placeImage)) urls.push(placeImage);

	return urls;
}

function getHost(row: BaliComEventRow): string | undefined {
	return row.places?.place_name?.trim() || undefined;
}

function getHostLink(row: BaliComEventRow): string | undefined {
	const website = row.places?.place_website?.trim();
	if (website?.startsWith(`http`)) return website;

	const instagram = toInstagramUrl(row.places?.place_instagram);
	if (instagram) return instagram;

	const slug = row.places?.place_url_slug?.trim();
	if (slug) return `https://bali.com${slug.startsWith(`/`) ? slug : `/${slug}`}`;

	return undefined;
}

function getContact(row: BaliComEventRow): string[] {
	const contact: string[] = [];

	for (const candidate of [
		row.event_booking_url,
		row.event_info_url,
		row.places?.place_website,
		toInstagramUrl(row.places?.place_instagram),
		row.event_gmap_url,
	]) {
		const url = candidate?.trim();
		if (!url?.startsWith(`http`)) continue;
		if (contact.includes(url)) continue;
		contact.push(url);
	}

	return contact;
}

function getTags(row: BaliComEventRow): string[] {
	const tags = new Set<string>();
	if (row.event_category?.trim()) tags.add(row.event_category.trim());
	if (row.event_area?.trim()) tags.add(row.event_area.trim());
	return [...tags];
}

function getSourceUrl(row: BaliComEventRow): string {
	const slug = row.event_slug?.trim();
	if (slug) return `${SITE_BASE}/events/${slug}`;
	return `${SITE_BASE}/events/${row.id}`;
}

function getStartAt(args: { row: BaliComEventRow; occurrenceDate: Date }): string | undefined {
	const { row, occurrenceDate } = args;
	if (row.event_fullday) {
		return dateToIsoStr(
			occurrenceDate.getFullYear(),
			occurrenceDate.getMonth() + 1,
			occurrenceDate.getDate(),
			0,
			0,
			TIMEZONE,
			false,
		);
	}

	const time = parseTime(row.event_time_begin) ?? { hour: 0, minute: 0 };
	return dateToIsoStr(
		occurrenceDate.getFullYear(),
		occurrenceDate.getMonth() + 1,
		occurrenceDate.getDate(),
		time.hour,
		time.minute,
		TIMEZONE,
		false,
	);
}

function getEndAt(args: {
	row: BaliComEventRow;
	occurrenceDate: Date;
}): string | undefined {
	const { row, occurrenceDate } = args;
	if (row.event_fullday) {
		return dateToIsoStr(
			occurrenceDate.getFullYear(),
			occurrenceDate.getMonth() + 1,
			occurrenceDate.getDate(),
			23,
			59,
			TIMEZONE,
			false,
		);
	}

	const startTime = parseTime(row.event_time_begin) ?? { hour: 0, minute: 0 };
	const endTime = parseTime(row.event_time_end);
	if (!endTime) return undefined;

	let endDate = occurrenceDate;
	if (
		endTime.hour < startTime.hour ||
		(endTime.hour === startTime.hour && endTime.minute <= startTime.minute)
	) {
		endDate = addDays(occurrenceDate, 1);
	}

	return dateToIsoStr(
		endDate.getFullYear(),
		endDate.getMonth() + 1,
		endDate.getDate(),
		endTime.hour,
		endTime.minute,
		TIMEZONE,
		false,
	);
}

function getOccurrenceDates(args: {
	row: BaliComEventRow;
	rangeStart: Date;
	rangeEnd: Date;
}): Date[] {
	const { row, rangeStart, rangeEnd } = args;

	if (row.event_dates?.length) {
		return row.event_dates
			.map((value) => parseDateOnly(value))
			.filter((date): date is Date => {
				if (!date) return false;
				if (date < rangeStart) return false;
				if (date > rangeEnd) return false;
				return true;
			});
	}

	const onceDate = parseDateOnly(row.event_date);
	if (!onceDate) return [];
	if (onceDate < rangeStart || onceDate > rangeEnd) return [];
	return [onceDate];
}

function supabaseHeaders() {
	return {
		apikey: SUPABASE_KEY,
		Authorization: `Bearer ${SUPABASE_KEY}`,
		Accept: `application/json`,
	};
}

function formatDateOnly(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, `0`);
	const day = String(date.getDate()).padStart(2, `0`);
	return `${year}-${month}-${day}`;
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

function parseDateOnly(value: string | null | undefined) {
	if (!value) return undefined;
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	return new Date(year, month - 1, day);
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
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type BaliComPlace = {
	id: string;
	place_name: string | null;
	place_area: string | null;
	place_lat: number | null;
	place_long: number | null;
	place_website: string | null;
	place_instagram: string | null;
	place_url_slug: string | null;
	place_image_url: string | null;
	place_image_url_wp: string | null;
};

type BaliComEventRow = {
	id: string;
	event_status: string | null;
	event_name: string | null;
	event_slug: string | null;
	event_category: string | null;
	event_area: string | null;
	event_date: string | null;
	event_fullday: boolean | null;
	event_time_begin: string | null;
	event_time_end: string | null;
	event_descr: string | null;
	event_image_url: string | null;
	venue_place_id: string | null;
	event_booking_url: string | null;
	event_info_url: string | null;
	event_gmap_url: string | null;
	event_price: string | null;
	event_dates: string[] | null;
	event_recurrence_type: string | null;
	event_last_date: string | null;
	places: BaliComPlace | null;
};
