/**
 * Scrapes balievents.co via their public Supabase REST API
 * (`active_validated_events` + venues). Recurring events expand up to 90
 * days. Names are filtered with the whitelist/blacklist.
 *
 * Usage:
 *   bun run scripts/scrape-balievents.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SUPABASE_URL = `https://uyueqyedxphgdkaiwwsj.supabase.co`;
const SUPABASE_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5dWVxeWVkeHBoZ2RrYWl3d3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxMzgxNzMsImV4cCI6MjA2MjcxNDE3M30.ZjOlKUcEQDlFp9S3jeTwRqcINcOrz6z-5wClJvLkjXA`;
const SITE_BASE = `https://www.balievents.co`;
const TIMEZONE = `Asia/Makassar`;
const PAGE_SIZE = 100;
const OCCURRENCE_DAYS_AHEAD = 90;

const DAY_NAME_TO_JS: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

const EVENT_COLUMNS = [
	`id`,
	`title`,
	`slug`,
	`image`,
	`event_image`,
	`date`,
	`time`,
	`end_time`,
	`venue`,
	`location`,
	`price`,
	`promoted_price`,
	`description`,
	`ticket_url`,
	`tag`,
	`category`,
	`frequency`,
	`organizer_instagram`,
	`artist_name`,
	`artist_instagram`,
	`is_festival`,
	`event_timestamp`,
	`start_dates`,
] as const;

const VENUE_COLUMNS = [
	`id`,
	`name`,
	`location`,
	`lat`,
	`lng`,
	`address`,
	`slug`,
] as const;

const EVENT_EXTRAS_COLUMNS = [
	`id`,
	`contact_whatsapp`,
	`venues(lat,lng)`,
] as const;
const EVENT_EXTRAS_SELECT = EVENT_EXTRAS_COLUMNS.join(`,`);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];

		console.error(`Fetching BaliEvents via Supabase REST...`);
		await this.assertExpectedSchema();

		const rangeStart = startOfLocalDay(new Date(), TIMEZONE);
		const rangeEnd = addDays(rangeStart, OCCURRENCE_DAYS_AHEAD);

		const [rows, venues] = await Promise.all([
			this.fetchAllEvents({ rangeStart, rangeEnd }),
			this.fetchAllVenues(),
		]);
		const venueByKey = indexVenues(venues);
		const extrasByEventId = await this.fetchEventExtras(rows.map((row) => row.id));
		console.error(`Fetched ${rows.length} future events and ${venues.length} venues. Mapping...`);

		for (const row of rows) {
			try {
				const events = await this.rowToEvents({
					row,
					venueByKey,
					extrasByEventId,
					rangeStart,
					rangeEnd,
				});
				allEvents.push(...events);
			} catch (error) {
				console.error(`Failed to process event ${row.id} (${row.title}):`, error);
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
		const checks = [
			{
				label: `active_validated_events`,
				path: `active_validated_events`,
				select: EVENT_COLUMNS.join(`,`),
			},
			{
				label: `venues`,
				path: `venues`,
				select: VENUE_COLUMNS.join(`,`),
			},
			{
				label: `events extras`,
				path: `events`,
				select: EVENT_EXTRAS_SELECT,
			},
		];

		for (const check of checks) {
			const params = new URLSearchParams({
				select: check.select,
				limit: `0`,
			});
			const res = await fetch(`${SUPABASE_URL}/rest/v1/${check.path}?${params}`, {
				headers: supabaseHeaders(),
			});
			if (res.ok) continue;
			throw new Error(
				`BaliEvents schema check failed for ${check.label}: expected columns missing or unreadable. ${res.status} ${await res.text()}`,
			);
		}

		console.error(`Schema check passed for events, venues, and events→venues join.`);
	}

	private async fetchAllEvents(args: {
		rangeStart: Date;
		rangeEnd: Date;
	}): Promise<BaliEventsRow[]> {
		const { rangeStart, rangeEnd } = args;
		const rows: BaliEventsRow[] = [];
		let offset = 0;
		const today = formatDateOnly(rangeStart);
		const futureStartDates = datesBetween({ start: rangeStart, end: rangeEnd });
		// Only future rows: timestamp >= today, recurring templates, or start_dates overlapping the window.
		const paramsBase = {
			select: EVENT_COLUMNS.join(`,`),
			or: `(event_timestamp.gte.${today},frequency.in.(weekly,daily),start_dates.ov.{${futureStartDates.join(`,`)}})`,
			order: `event_timestamp.asc`,
			limit: String(PAGE_SIZE),
		};

		while (true) {
			const params = new URLSearchParams({
				...paramsBase,
				offset: String(offset),
			});

			const res = await fetch(
				`${SUPABASE_URL}/rest/v1/active_validated_events?${params}`,
				{ headers: supabaseHeaders() },
			);
			if (!res.ok) throw new Error(`Events query failed: ${res.status} ${await res.text()}`);

			const page = (await res.json()) as BaliEventsRow[];
			rows.push(...page);
			console.error(`  events offset ${offset} — ${rows.length} rows so far`);

			if (page.length < PAGE_SIZE) break;
			offset += PAGE_SIZE;
			await sleep(100);
		}

		return rows;
	}

	private async fetchAllVenues(): Promise<BaliVenue[]> {
		const rows: BaliVenue[] = [];
		let offset = 0;

		while (true) {
			const params = new URLSearchParams({
				select: VENUE_COLUMNS.join(`,`),
				order: `name.asc`,
				limit: String(PAGE_SIZE),
				offset: String(offset),
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/venues?${params}`, {
				headers: supabaseHeaders(),
			});
			if (!res.ok) throw new Error(`Venues query failed: ${res.status} ${await res.text()}`);

			const page = (await res.json()) as BaliVenue[];
			rows.push(...page);
			if (page.length < PAGE_SIZE) break;
			offset += PAGE_SIZE;
			await sleep(100);
		}

		return rows;
	}

	private async fetchEventExtras(eventIds: string[]) {
		const extrasByEventId = new Map<string, EventExtras>();
		if (!eventIds?.length) return extrasByEventId;

		for (let i = 0; i < eventIds.length; i += 50) {
			const chunk = eventIds.slice(i, i + 50);
			const params = new URLSearchParams({
				select: EVENT_EXTRAS_SELECT,
				id: `in.(${chunk.join(`,`)})`,
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
				headers: supabaseHeaders(),
			});
			if (!res.ok) {
				console.error(`Event extras query failed: ${res.status} ${await res.text()}`);
				continue;
			}

			const page = (await res.json()) as {
				id: string;
				contact_whatsapp: string | null;
				venues: { lat: number | null; lng: number | null } | null;
			}[];

			for (const item of page) {
				const lat = item.venues?.lat;
				const lng = item.venues?.lng;
				extrasByEventId.set(item.id, {
					contactWhatsapp: item.contact_whatsapp?.trim() || undefined,
					lat: typeof lat === `number` ? lat : undefined,
					lng: typeof lng === `number` ? lng : undefined,
				});
			}

			await sleep(50);
		}

		return extrasByEventId;
	}

	private async rowToEvents(args: {
		row: BaliEventsRow;
		venueByKey: Map<string, BaliVenue>;
		extrasByEventId: Map<string, EventExtras>;
		rangeStart: Date;
		rangeEnd: Date;
	}): Promise<ScrapedEvent[]> {
		const { row, venueByKey, extrasByEventId, rangeStart, rangeEnd } = args;

		const name = this.extractNameFromRow(row);
		if (!name) return [];
		if (matchesBlackListWords(name) || !matchesWhiteListWords(name)) {
			console.error(`Skipping ${name} (title failed whitelist/blacklist filter)`);
			return [];
		}

		const occurrenceDates = this.getOccurrenceDates({ row, rangeStart, rangeEnd });
		if (!occurrenceDates?.length) return [];

		const extras = extrasByEventId.get(row.id);
		const description = this.extractDescriptionFromRow(row);
		const address = this.extractAddressFromRow(row);
		const price = this.extractPriceFromRow(row);
		const imageUrls = this.extractImageUrlsFromRow(row);
		const host = this.extractHostFromRow(row);
		const hostLink = this.extractHostLinkFromRow(row);
		const tags = this.extractTagsFromRow(row);
		const contact = this.extractContactFromRow(row, extras);
		const coords = this.resolveCoordinates({ row, venueByKey, extras });

		const events: ScrapedEvent[] = [];
		for (const occurrenceDate of occurrenceDates) {
			try {
				const startAt = this.buildStartAt(row, occurrenceDate);
				if (!startAt) continue;
				const endAt = this.buildEndAt(row, occurrenceDate);

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
					latitude: coords?.lat,
					longitude: coords?.lng,
					timezone: coords?.timezone ?? TIMEZONE,
					tags,
					sourceUrl: this.buildSourceUrl(row),
					source: `balievents`,
				} satisfies ScrapedEvent);
			} catch (error) {
				console.error(`Failed to map occurrence for ${row.id} (${row.title}):`, error);
			}
		}
		return events;
	}

	private extractNameFromRow(row: BaliEventsRow): string | undefined {
		const title = row.title?.replace(/\s+/g, ` `).trim();
		if (!title) return undefined;
		return title;
	}

	private extractDescriptionFromRow(row: BaliEventsRow): string | undefined {
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

	private extractAddressFromRow(row: BaliEventsRow): string[] {
		const lines: string[] = [];
		if (row.venue?.trim()) lines.push(row.venue.trim());
		if (row.location?.trim()) {
			const location = row.location.trim();
			if (!lines.some((line) => line.toLowerCase() === location.toLowerCase())) {
				lines.push(location);
			}
		}
		if (!lines?.length) lines.push(`Bali`);
		return lines;
	}

	private extractPriceFromRow(row: BaliEventsRow): string | undefined {
		const promoted = row.promoted_price?.trim();
		const price = promoted || row.price?.trim();
		if (!price) return undefined;
		if (/^free$/i.test(price)) return `Free`;
		if (/^see tickets$/i.test(price)) return undefined;
		return price;
	}

	private extractImageUrlsFromRow(row: BaliEventsRow): string[] {
		const urls: string[] = [];
		for (const candidate of [row.image, row.event_image]) {
			const url = candidate?.trim();
			if (!url?.startsWith(`http`)) continue;
			if (urls.includes(url)) continue;
			urls.push(url);
		}
		return urls;
	}

	private extractHostFromRow(row: BaliEventsRow): string | undefined {
		const artist = row.artist_name?.trim();
		if (artist) return artist;
		const venue = row.venue?.trim();
		if (venue) return venue;
		return undefined;
	}

	private extractHostLinkFromRow(row: BaliEventsRow): string | undefined {
		return toInstagramUrl(row.artist_instagram) || toInstagramUrl(row.organizer_instagram);
	}

	private extractContactFromRow(row: BaliEventsRow, extras?: EventExtras): string[] {
		const contact: string[] = [];

		const artistIg = toInstagramUrl(row.artist_instagram);
		if (artistIg) contact.push(artistIg);

		const organizerIg = toInstagramUrl(row.organizer_instagram);
		if (organizerIg && !contact.includes(organizerIg)) contact.push(organizerIg);

		const whatsapp = toWhatsappUrl(extras?.contactWhatsapp ?? row.contact_whatsapp);
		if (whatsapp && !contact.includes(whatsapp)) contact.push(whatsapp);

		const ticketUrl = row.ticket_url?.trim();
		if (ticketUrl?.startsWith(`http`) && !contact.includes(ticketUrl)) contact.push(ticketUrl);

		return contact;
	}

	private extractTagsFromRow(row: BaliEventsRow): string[] {
		const tags = new Set<string>();
		if (row.tag?.trim()) tags.add(row.tag.trim());
		if (row.is_festival) tags.add(`festival`);
		return [...tags];
	}

	private buildSourceUrl(row: BaliEventsRow): string {
		const slug = row.slug?.trim();
		if (slug) return `${SITE_BASE}/event/${slug}`;
		return `${SITE_BASE}/event/${row.id}`;
	}

	private buildStartAt(row: BaliEventsRow, occurrenceDate: Date): string | undefined {
		const time = parseTime(row.time) ?? { hour: 0, minute: 0 };
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

	private buildEndAt(row: BaliEventsRow, occurrenceDate: Date): string | undefined {
		const startTime = parseTime(row.time) ?? { hour: 0, minute: 0 };
		const endTime = parseTime(row.end_time) ?? {
			hour: startTime.hour + 2,
			minute: startTime.minute,
		};

		let endDate = occurrenceDate;
		let endHour = endTime.hour;
		let endMinute = endTime.minute;

		if (endHour >= 24) {
			endDate = addDays(occurrenceDate, Math.floor(endHour / 24));
			endHour = endHour % 24;
		} else if (
			endHour < startTime.hour ||
			(endHour === startTime.hour && endMinute <= startTime.minute)
		) {
			endDate = addDays(occurrenceDate, 1);
		}

		return dateToIsoStr(
			endDate.getFullYear(),
			endDate.getMonth() + 1,
			endDate.getDate(),
			endHour,
			endMinute,
			TIMEZONE,
			false,
		);
	}

	private getOccurrenceDates(args: {
		row: BaliEventsRow;
		rangeStart: Date;
		rangeEnd: Date;
	}): Date[] {
		const { row, rangeStart, rangeEnd } = args;

		if (row.start_dates?.length) {
			return row.start_dates
				.map((value) => parseDateOnly(value))
				.filter((date): date is Date => {
					if (!date) return false;
					if (date < rangeStart) return false;
					if (date > rangeEnd) return false;
					return true;
				});
		}

		const frequency = row.frequency?.toLowerCase() || `once`;

		if (frequency === `once`) {
			const onceDate = this.resolveOnceDate(row);
			if (!onceDate) return [];
			if (onceDate < rangeStart || onceDate > rangeEnd) return [];
			return [onceDate];
		}

		if (frequency === `daily`) {
			const dates: Date[] = [];
			for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
				dates.push(new Date(cursor));
			}
			return dates;
		}

		if (frequency === `weekly`) {
			const weekday = this.resolveWeekday(row);
			if (weekday === undefined) return [];
			const dates: Date[] = [];
			for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
				if (cursor.getDay() !== weekday) continue;
				dates.push(new Date(cursor));
			}
			return dates;
		}

		console.error(`Unrecognized frequency for ${row.id}: ${row.frequency}`);
		return [];
	}

	private resolveOnceDate(row: BaliEventsRow): Date | undefined {
		if (row.start_dates?.length) return parseDateOnly(row.start_dates[0]);
		return localDateFromEventTimestamp(row);
	}

	private resolveWeekday(row: BaliEventsRow): number | undefined {
		const fromDateField = row.date?.trim().match(/^([A-Za-z]{3})\b/);
		if (fromDateField) {
			const weekday = DAY_NAME_TO_JS[fromDateField[1]];
			if (weekday !== undefined) return weekday;
		}

		const localDate = localDateFromEventTimestamp(row);
		if (!localDate) return undefined;
		return localDate.getDay();
	}

	private resolveCoordinates(args: {
		row: BaliEventsRow;
		venueByKey: Map<string, BaliVenue>;
		extras?: EventExtras;
	}) {
		const { row, venueByKey, extras } = args;

		if (typeof extras?.lat === `number` && typeof extras?.lng === `number`) {
			return { lat: extras.lat, lng: extras.lng, timezone: TIMEZONE };
		}

		const venue = lookupVenue(venueByKey, row.venue, row.location);
		if (venue && typeof venue.lat === `number` && typeof venue.lng === `number`) {
			return { lat: venue.lat, lng: venue.lng, timezone: TIMEZONE };
		}

		return undefined;
	}
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

function datesBetween(args: { start: Date; end: Date }) {
	const dates: string[] = [];
	for (let cursor = new Date(args.start); cursor <= args.end; cursor = addDays(cursor, 1)) {
		dates.push(formatDateOnly(cursor));
	}
	return dates;
}

function indexVenues(venues: BaliVenue[]) {
	const map = new Map<string, BaliVenue>();
	for (const venue of venues) {
		const name = venue.name?.trim();
		if (!name) continue;
		const location = venue.location?.trim() || ``;
		map.set(venueKey(name, location), venue);
		if (!map.has(venueKey(name, ``))) map.set(venueKey(name, ``), venue);
	}
	return map;
}

function lookupVenue(
	venueByKey: Map<string, BaliVenue>,
	venueName: string | null | undefined,
	location: string | null | undefined,
) {
	const name = venueName?.trim();
	if (!name) return undefined;
	const loc = location?.trim() || ``;
	return venueByKey.get(venueKey(name, loc)) || venueByKey.get(venueKey(name, ``));
}

function venueKey(name: string, location: string) {
	return `${name.toLowerCase()}|${location.toLowerCase()}`;
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

function localDateFromEventTimestamp(row: BaliEventsRow): Date | undefined {
	const ts = row.event_timestamp?.trim();
	if (!ts) return undefined;

	const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!match) return undefined;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const time = parseTime(row.time);

	// Most rows store event_timestamp in UTC; older weekly rows store local wall time.
	if (time && (hour + 8) % 24 === time.hour && minute === time.minute) {
		const utcMs = Date.UTC(year, month - 1, day, hour, minute);
		const baliMs = utcMs + 8 * 60 * 60 * 1000;
		const bali = new Date(baliMs);
		return new Date(bali.getUTCFullYear(), bali.getUTCMonth(), bali.getUTCDate());
	}

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
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type BaliEventsRow = {
	id: string;
	title: string | null;
	slug: string | null;
	image: string | null;
	event_image: string | null;
	date: string | null;
	time: string | null;
	end_time: string | null;
	venue: string | null;
	location: string | null;
	price: string | null;
	promoted_price: string | null;
	description: string | null;
	ticket_url: string | null;
	tag: string | null;
	category: string | null;
	frequency: string | null;
	organizer_instagram: string | null;
	artist_name: string | null;
	artist_instagram: string | null;
	contact_whatsapp?: string | null;
	is_festival: boolean | null;
	event_timestamp: string | null;
	start_dates: string[] | null;
};

type EventExtras = {
	contactWhatsapp?: string;
	lat?: number;
	lng?: number;
};

type BaliVenue = {
	id: string;
	name: string | null;
	location: string | null;
	lat: number | null;
	lng: number | null;
	address: string | null;
	slug: string | null;
};
