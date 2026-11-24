/**
 * Scrapes Bali Buddy app events via the public WordPress API on balibuddy.app
 * (`/wp-json/v1/event-date-listing`). Distinct from balibuddies.com HTML scrapers.
 *
 * Usage:
 *   bun run scripts/scrape-balibuddy.ts
 *   bun run scripts/scrape-balibuddy.ts --limit 10
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	sleep,
	REQUEST_DELAY_MS,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const API_BASE = `https://balibuddy.app/wp-json/v1`;
const SOURCE = `balibuddy` as const;
const TIME_ZONE = `Asia/Makassar` as const;
const OCCURRENCE_DAYS_AHEAD = 90;
const MAX_PAGES = 50;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Bali Buddy events via ${API_BASE}/event-date-listing${resolvedLimit != null ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		const range = dateRangeAhead(OCCURRENCE_DAYS_AHEAD);
		let listings: BaliBuddyListing[];
		try {
			listings = await fetchEventListings({ from: range.from, to: range.to });
		} catch (error) {
			console.error(`Failed to fetch Bali Buddy event listings:`, error);
			return [];
		}
		console.error(`Loaded ${listings.length} event listings. Mapping...`);

		const kept: ScrapedEvent[] = [];
		const seen = new Set<string>();
		let skippedFilter = 0;
		let skippedIncomplete = 0;

		for (const listing of listings) {
			if (resolvedLimit != null && kept.length >= resolvedLimit) break;
			try {
				const name = getName(listing);
				if (!name) {
					skippedIncomplete++;
					continue;
				}
				if (matchesBlackListWords(name) || !matchesWhiteListWords(name)) {
					skippedFilter++;
					continue;
				}

				const event = mapListing(listing);
				if (!event) {
					skippedIncomplete++;
					continue;
				}
				if (seen.has(event.sourceUrl)) continue;
				seen.add(event.sourceUrl);
				kept.push(event);
			} catch (error) {
				console.error(`Failed to process Bali Buddy listing ${listing?.id}:`, error);
			}
		}

		console.error(
			`Bali Buddy keep: ${kept.length} (filtered ${skippedFilter}, incomplete ${skippedIncomplete})`,
		);
		console.error(`--- Scraping finished. Total events collected: ${kept.length} ---`);
		return kept;
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

export function mapListing(listing: BaliBuddyListing): ScrapedEvent | undefined {
	const name = getName(listing);
	const startAt = getStartAt(listing);
	const sourceUrl = getSourceUrl(listing);
	if (!name || !startAt || !sourceUrl) return undefined;

	const coords = getCoordinates(listing);
	return {
		name,
		description: getDescription(listing),
		imageUrls: getImageUrls(listing),
		startAt,
		endAt: getEndAt(listing),
		address: getAddress(listing),
		price: getPrice(listing),
		priceIsHtml: false,
		host: getHost(listing),
		hostLink: undefined,
		contact: getContact(listing),
		latitude: coords?.lat,
		longitude: coords?.lng,
		timezone: TIME_ZONE,
		tags: getTags(listing),
		sourceUrl,
		source: SOURCE,
	};
}

export function getName(listing: BaliBuddyListing): string | undefined {
	const title = listing.title?.replace(/\s+/g, ` `).trim();
	return title || undefined;
}

export function getStartAt(listing: BaliBuddyListing): string | undefined {
	const occurrence = getOccurrenceDate(listing);
	const time = parseAmPmTime(listing.start_time) ?? { hour: 0, minute: 0 };
	if (!occurrence) return undefined;
	return dateToIsoStr(occurrence.year, occurrence.month, occurrence.day, time.hour, time.minute, TIME_ZONE, false);
}

export function getEndAt(listing: BaliBuddyListing): string | undefined {
	const occurrence = getOccurrenceDate(listing);
	const endTime = parseAmPmTime(listing.end_time);
	if (!occurrence || !endTime) return undefined;

	const startTime = parseAmPmTime(listing.start_time) ?? { hour: 0, minute: 0 };
	let { year, month, day } = occurrence;
	const startMinutes = startTime.hour * 60 + startTime.minute;
	const endMinutes = endTime.hour * 60 + endTime.minute;
	if (endMinutes <= startMinutes) {
		const rolled = addOneCalendarDay(occurrence);
		year = rolled.year;
		month = rolled.month;
		day = rolled.day;
	}
	return dateToIsoStr(year, month, day, endTime.hour, endTime.minute, TIME_ZONE, false);
}

export function getAddress(listing: BaliBuddyListing): string[] {
	const raw = listing.location?.[0]?.address?.trim();
	if (!raw) return [];
	return raw
		.split(`,`)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function getPrice(listing: BaliBuddyListing): string | undefined {
	const raw = listing.fromPrice?.toString().trim();
	if (!raw) return undefined;
	if (/^free$/i.test(raw)) return `Free`;
	const amount = Number(raw.replace(/[^\d.]/g, ``));
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	return `Rp ${Math.round(amount).toLocaleString(`de-DE`)}`;
}

export function getDescription(listing: BaliBuddyListing): string | undefined {
	const cleaned = cleanProseHtml(listing.content)?.trim();
	return cleaned || undefined;
}

export function getImageUrls(listing: BaliBuddyListing): string[] {
	const urls: string[] = [];
	for (const candidate of [listing.background_image, listing.logo, ...(listing.gallery ?? [])]) {
		const url = typeof candidate === `string` ? candidate.trim() : ``;
		if (!url.startsWith(`http`)) continue;
		if (urls.includes(url)) continue;
		urls.push(url);
	}
	return urls;
}

export function getHost(listing: BaliBuddyListing): string | undefined {
	const business = listing.business_title;
	if (business && typeof business === `object` && !Array.isArray(business)) {
		const name = business.name?.trim();
		if (name) return name;
	}
	const promoter = listing.megatix_source?.promoter?.trim();
	return promoter || undefined;
}

export function getContact(listing: BaliBuddyListing): string[] {
	const contact: string[] = [];
	const phone = listing.phone_number?.trim();
	if (phone) contact.push(phone);
	const tickets = listing.get_tickets?.trim();
	if (tickets?.startsWith(`http`)) contact.push(tickets);
	else {
		const megatix = listing.megatix_source?.ticket_url?.trim();
		if (megatix?.startsWith(`http`)) contact.push(megatix);
	}
	return contact;
}

export function getTags(listing: BaliBuddyListing): string[] {
	const tags = new Set<string>();
	for (const category of listing.categories ?? []) {
		const value = category?.trim();
		if (value) tags.add(value);
	}
	for (const tag of listing.tags ?? []) {
		const value = tag?.name?.trim();
		if (value) tags.add(value);
	}
	return [...tags];
}

export function getSourceUrl(listing: BaliBuddyListing): string | undefined {
	const link = listing.link?.trim();
	return link?.startsWith(`http`) ? link : undefined;
}

export function getCoordinates(listing: BaliBuddyListing): { lat: number; lng: number } | undefined {
	const loc = listing.location?.[0];
	if (!loc) return undefined;
	const lat = Number(loc.lat);
	const lng = Number(loc.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
	if (lat === 0 && lng === 0) return undefined;
	return { lat, lng };
}

export function getOccurrenceDate(listing: BaliBuddyListing): CalendarDay | undefined {
	const first = listing.next_event_date?.find((value) => typeof value === `string` && value.trim());
	if (!first) return undefined;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(first.trim());
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (![year, month, day].every(Number.isFinite)) return undefined;
	return { year, month, day };
}

/** Parses Bali Buddy wall times like `04:00:00 PM` or `7:00 PM`. */
export function parseAmPmTime(value: string | null | undefined): { hour: number; minute: number } | undefined {
	if (!value?.trim()) return undefined;
	const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i.exec(value.trim());
	if (!match) return undefined;
	let hour = Number(match[1]);
	const minute = Number(match[2]);
	const meridiem = match[3]!.toUpperCase();
	if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute > 59) return undefined;
	if (meridiem === `AM`) {
		if (hour === 12) hour = 0;
	} else if (hour !== 12) {
		hour += 12;
	}
	return { hour, minute };
}

export function dateRangeAhead(days: number): { from: string; to: string } {
	const from = new Date();
	const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
	return { from: formatDateOnlyUtc(from), to: formatDateOnlyUtc(to) };
}

async function fetchEventListings({ from, to }: { from: string; to: string }): Promise<BaliBuddyListing[]> {
	const all: BaliBuddyListing[] = [];
	let page = 1;
	let hasMore = true;

	while (hasMore && page <= MAX_PAGES) {
		if (page > 1) await sleep(REQUEST_DELAY_MS);
		const url = `${API_BASE}/event-date-listing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${page}`;
		const body = await customFetch(url, { returnType: `json` });
		const parsed = parseListingPage(body, page);
		all.push(...parsed.listings);
		hasMore = parsed.hasMore;
		console.error(
			`Bali Buddy page ${parsed.currentPage}/${parsed.totalPages || `?`}: ${parsed.listings.length} listings (total so far ${all.length})`,
		);
		page++;
	}

	return dedupeById(all);
}

export function parseListingPage(body: unknown, expectedPage: number): ListingPage {
	if (!body || typeof body !== `object`) throw new Error(`Bali Buddy page ${expectedPage} was not an object`);
	const record = body as Record<string, unknown>;
	if (record.success === false) {
		throw new Error(`Bali Buddy page ${expectedPage} failed: ${String(record.message ?? `unknown`)}`);
	}
	if (!Array.isArray(record.data)) throw new Error(`Bali Buddy page ${expectedPage} has no data array`);

	const listings: BaliBuddyListing[] = [];
	for (const row of record.data) {
		const listing = parseListing(row);
		if (!listing) continue;
		listings.push(listing);
	}

	const currentPage = readNumber(record.current_page) ?? expectedPage;
	const totalPages = readNumber(record.total_pages) ?? currentPage;
	const hasMore =
		typeof record.has_more === `boolean` ? record.has_more : currentPage < totalPages && listings.length > 0;

	return { listings, currentPage, totalPages, hasMore };
}

function parseListing(row: unknown): BaliBuddyListing | undefined {
	if (!row || typeof row !== `object`) return undefined;
	const record = row as Record<string, unknown>;
	const id = record.id;
	if (id == null) return undefined;

	const businessRaw = record.business_title;
	let business_title: BaliBuddyListing[`business_title`];
	if (businessRaw && typeof businessRaw === `object` && !Array.isArray(businessRaw)) {
		const business = businessRaw as Record<string, unknown>;
		business_title = {
			id: readNumber(business.id),
			name: readText(business.name),
		};
	} else {
		business_title = [];
	}

	const megatixRaw = record.megatix_source;
	let megatix_source: BaliBuddyListing[`megatix_source`];
	if (megatixRaw && typeof megatixRaw === `object` && !Array.isArray(megatixRaw)) {
		const megatix = megatixRaw as Record<string, unknown>;
		megatix_source = {
			event_id: readText(megatix.event_id) ?? (readNumber(megatix.event_id)?.toString() ?? null),
			slug: readText(megatix.slug),
			promoter: readText(megatix.promoter),
			ticket_url: readText(megatix.ticket_url),
		};
	}

	const location = Array.isArray(record.location)
		? record.location
				.map((item) => {
					if (!item || typeof item !== `object`) return undefined;
					const loc = item as Record<string, unknown>;
					return {
						address: readText(loc.address) ?? ``,
						lat: readText(loc.lat) ?? (readNumber(loc.lat)?.toString() ?? ``),
						lng: readText(loc.lng) ?? (readNumber(loc.lng)?.toString() ?? ``),
					};
				})
				.filter((item): item is NonNullable<typeof item> => !!item)
		: [];

	const tags = Array.isArray(record.tags)
		? record.tags
				.map((item) => {
					if (!item || typeof item !== `object`) return undefined;
					const tag = item as Record<string, unknown>;
					const name = readText(tag.name);
					if (!name) return undefined;
					return { name };
				})
				.filter((item): item is { name: string } => !!item)
		: [];

	const categories = Array.isArray(record.categories)
		? record.categories.map((item) => (typeof item === `string` ? item : ``)).filter(Boolean)
		: [];

	const next_event_date = Array.isArray(record.next_event_date)
		? record.next_event_date.map((item) => (typeof item === `string` ? item : ``)).filter(Boolean)
		: [];

	const gallery = Array.isArray(record.gallery)
		? record.gallery.map((item) => (typeof item === `string` ? item : ``)).filter(Boolean)
		: [];

	return {
		id,
		title: readText(record.title) ?? ``,
		content: readText(record.content) ?? ``,
		link: readText(record.link) ?? ``,
		phone_number: readText(record.phone_number) ?? ``,
		get_tickets: readText(record.get_tickets) ?? ``,
		listing_type: readText(record.listing_type) ?? ``,
		logo: readText(record.logo) ?? ``,
		background_image: readText(record.background_image) ?? ``,
		gallery,
		categories,
		tags,
		start_time: readText(record.start_time),
		end_time: readText(record.end_time),
		next_event_date,
		fromPrice: readText(record.fromPrice) ?? (readNumber(record.fromPrice)?.toString() ?? ``),
		location,
		business_title,
		megatix_source,
	};
}

function dedupeById(listings: BaliBuddyListing[]): BaliBuddyListing[] {
	const map = new Map<string, BaliBuddyListing>();
	for (const listing of listings) {
		map.set(String(listing.id), listing);
	}
	return [...map.values()];
}

function addOneCalendarDay(day: CalendarDay): CalendarDay {
	const date = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
	};
}

function formatDateOnlyUtc(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, `0`);
	const day = String(date.getUTCDate()).padStart(2, `0`);
	return `${year}-${month}-${day}`;
}

function readText(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value === `string` && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number } {
	let limit: number | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit`) {
			const next = argv[i + 1];
			const parsed = next ? Number(next) : NaN;
			if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
			i++;
			continue;
		}
		if (arg?.startsWith(`--limit=`)) {
			const parsed = Number(arg.slice(`--limit=`.length));
			if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
		}
	}
	return { limit };
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite();
		console.log(JSON.stringify(events.slice(0, 3), null, 2));
		console.error(`Sampled ${Math.min(3, events.length)} of ${events.length} events`);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type CalendarDay = { year: number; month: number; day: number };

type ListingPage = {
	listings: BaliBuddyListing[];
	currentPage: number;
	totalPages: number;
	hasMore: boolean;
};

type BaliBuddyListing = {
	id: string | number;
	title: string;
	content: string;
	link: string;
	phone_number: string;
	get_tickets: string;
	listing_type: string;
	logo: string;
	background_image: string;
	gallery: string[];
	categories: string[];
	tags: { name: string }[];
	start_time: string | undefined;
	end_time: string | undefined;
	next_event_date: string[];
	fromPrice: string;
	location: { address: string; lat: string; lng: string }[];
	business_title: { id?: number; name?: string } | [];
	megatix_source?: {
		event_id?: string | null;
		slug?: string;
		promoter?: string;
		ticket_url?: string;
	};
};
