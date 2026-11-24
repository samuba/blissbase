/**
 * Scrapes SEE Events Bali via their public Supabase PostgREST API
 * (`events` + embedded `venues`). Title `… at Venue` is only a fallback
 * when the venue embed is missing.
 *
 * Usage:
 *   bun run scripts/scrape-seeevents.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SUPABASE_URL = `https://ozndlmuucdquwjrunqhg.supabase.co`;
const SUPABASE_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bmRsbXV1Y2RxdXdqcnVucWhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDMzMzYsImV4cCI6MjEwNDk3OTMzNn0.G42noVQFxDOHivgzjA0qN55HchgpDRWm1VOIP-L6quY`;
const SITE_BASE = `https://app.see.events`;
const TIMEZONE = `Asia/Makassar`;
const PAGE_SIZE = 100;
const SOURCE = `seeevents` as const;

const EVENT_COLUMNS = [
	`id_event`,
	`title`,
	`slug`,
	`date_time`,
	`end_date_time`,
	`description`,
	`image_url`,
	`image_top_url`,
	`image_share_url`,
	`categories`,
	`price`,
	`latitude`,
	`longitude`,
	`area`,
	`address_override`,
	`ticket_buy_url`,
	`event_instagram_url`,
	`artists_links`,
	`music_genre`,
	`whatsapp_number_override`,
	`review_status`,
	`market`,
] as const;

const EVENT_SELECT = `${EVENT_COLUMNS.join(`,`)},venues(name,address,area)`;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];

		console.error(`Fetching SEE Events Bali via PostgREST...`);
		await this.assertExpectedSchema();

		const rows = await this.fetchFutureEvents();
		console.error(`Fetched ${rows.length} future published Bali events.`);

		for (const row of rows) {
			try {
				const event = rowToEvent(row);
				if (!event) continue;
				allEvents.push(event);
			} catch (error) {
				console.error(`Failed to process event ${row.id_event} (${row.title}):`, error);
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
			select: EVENT_SELECT,
			limit: `0`,
		});
		const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
			headers: supabaseHeaders(),
		});
		if (!res.ok) {
			throw new Error(
				`SEE Events schema check failed for events+venues embed: expected columns missing or unreadable. ${res.status} ${await res.text()}`,
			);
		}
		console.error(`Schema check passed for events+venues.`);
	}

	private async fetchFutureEvents(): Promise<SeeEventRow[]> {
		const rows: SeeEventRow[] = [];
		let offset = 0;
		const nowIso = new Date().toISOString();

		const paramsBase = {
			select: EVENT_SELECT,
			review_status: `eq.published`,
			market: `eq.bali`,
			date_time: `gte.${nowIso}`,
			order: `date_time.asc`,
			limit: String(PAGE_SIZE),
		};

		while (true) {
			const params = new URLSearchParams({
				...paramsBase,
				offset: String(offset),
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
				headers: supabaseHeaders(),
			});
			if (!res.ok) throw new Error(`Events query failed: ${res.status} ${await res.text()}`);

			const page = (await res.json()) as SeeEventRow[];
			rows.push(...page);
			console.error(`  events offset ${offset} — ${rows.length} rows so far`);

			if (page.length < PAGE_SIZE) break;
			offset += PAGE_SIZE;
			await sleep(100);
		}

		return rows;
	}
}

export function rowToEvent(row: SeeEventRow): ScrapedEvent | undefined {
	const name = getName(row);
	if (!name) return undefined;

	const haystack = `${name} ${getDescriptionPlain(row) ?? ``} ${(row.categories ?? []).join(` `)}`;
	if (matchesBlackListWords(name) || matchesBlackListWords(haystack)) {
		console.error(`Skipping ${name} (blacklist)`);
		return undefined;
	}
	if (!matchesWhiteListWords(name) && !matchesWhiteListWords(haystack)) {
		console.error(`Skipping ${name} (title/description failed whitelist filter)`);
		return undefined;
	}

	const startAt = getStartAt(row);
	if (!startAt) {
		console.error(`Skipping ${name} (no start time)`);
		return undefined;
	}

	const sourceUrl = getSourceUrl(row);
	if (!sourceUrl) {
		console.error(`Skipping ${name} (no source URL)`);
		return undefined;
	}

	return {
		name,
		description: getDescription(row),
		imageUrls: getImageUrls(row),
		startAt,
		endAt: getEndAt(row),
		address: getAddress(row),
		price: getPrice(row),
		priceIsHtml: false,
		host: getHost(row),
		hostLink: getHostLink(row),
		contact: getContact(row),
		latitude: getLatitude(row),
		longitude: getLongitude(row),
		timezone: TIMEZONE,
		tags: getTags(row),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export function getName(row: SeeEventRow): string | undefined {
	const title = row.title?.replace(/\s+/g, ` `).trim();
	if (!title) return undefined;
	return title;
}

export function getStartAt(row: SeeEventRow): string | undefined {
	return toMakassarIso(row.date_time);
}

export function getEndAt(row: SeeEventRow): string | undefined {
	return toMakassarIso(row.end_date_time);
}

export function getAddress(row: SeeEventRow): string[] {
	const lines: string[] = [];
	const pushUnique = (value: string | undefined) => {
		if (!value) return;
		if (lines.some((line) => line.toLowerCase() === value.toLowerCase())) return;
		lines.push(value);
	};

	pushUnique(nonempty(row.address_override));
	pushUnique(nonempty(row.venues?.address));
	pushUnique(nonempty(row.venues?.name) || venueNameFromTitle(row.title));
	pushUnique(nonempty(row.venues?.area) || nonempty(row.area));

	if (!lines.some((line) => /\bbali\b/i.test(line))) lines.push(`Bali`);
	return lines;
}

export function getPrice(row: SeeEventRow): string | undefined {
	const price = nonempty(row.price);
	if (!price) return undefined;
	if (/^free$/i.test(price)) return `Free`;
	return price;
}

export function getDescription(row: SeeEventRow): string | undefined {
	const raw = nonempty(row.description);
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

function getDescriptionPlain(row: SeeEventRow): string | undefined {
	return nonempty(row.description);
}

export function getImageUrls(row: SeeEventRow): string[] {
	const urls: string[] = [];
	for (const candidate of [row.image_url, row.image_top_url, row.image_share_url]) {
		const url = nonempty(candidate);
		if (!url?.startsWith(`http`)) continue;
		if (urls.includes(url)) continue;
		urls.push(url);
	}
	return urls;
}

export function getHost(row: SeeEventRow): string | undefined {
	const artist = firstArtistHandle(row.artists_links);
	if (artist) return artist;
	return nonempty(row.venues?.name) || venueNameFromTitle(row.title);
}

export function getHostLink(row: SeeEventRow): string | undefined {
	const ig = toInstagramUrl(row.event_instagram_url);
	if (ig) return ig;
	const artist = firstArtistHandle(row.artists_links);
	return toInstagramUrl(artist);
}

export function getContact(row: SeeEventRow): string[] {
	const contact: string[] = [];

	const ig = toInstagramUrl(row.event_instagram_url);
	if (ig) contact.push(ig);

	const artistIg = toInstagramUrl(firstArtistHandle(row.artists_links));
	if (artistIg && !contact.includes(artistIg)) contact.push(artistIg);

	const whatsapp = toWhatsappUrl(row.whatsapp_number_override);
	if (whatsapp && !contact.includes(whatsapp)) contact.push(whatsapp);

	for (const ticketUrl of splitHttpUrls(row.ticket_buy_url)) {
		if (!contact.includes(ticketUrl)) contact.push(ticketUrl);
	}

	return contact;
}

export function getTags(row: SeeEventRow): string[] {
	const tags = new Set<string>();
	for (const category of row.categories ?? []) {
		const tag = category?.trim();
		if (tag) tags.add(tag);
	}
	const genre = nonempty(row.music_genre);
	if (genre) tags.add(genre);
	return [...tags];
}

export function getLatitude(row: SeeEventRow): number | undefined {
	return finiteNumber(row.latitude);
}

export function getLongitude(row: SeeEventRow): number | undefined {
	return finiteNumber(row.longitude);
}

export function getSourceUrl(row: SeeEventRow): string | undefined {
	const slug = nonempty(row.slug);
	if (slug) return `${SITE_BASE}/event/${slug}`;
	const id = nonempty(row.id_event);
	if (id) return `${SITE_BASE}/event/${id}`;
	return undefined;
}

function supabaseHeaders() {
	return {
		apikey: SUPABASE_KEY,
		Authorization: `Bearer ${SUPABASE_KEY}`,
		Accept: `application/json`,
	};
}

function nonempty(value: string | null | undefined) {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimmed;
}

/** Some SEE rows glue multiple links into one string without a separator. */
function splitHttpUrls(value: string | null | undefined) {
	const raw = nonempty(value);
	if (!raw) return [];
	return raw
		.split(/(?=https?:\/\/)/i)
		.map((part) => part.trim())
		.filter((part) => part.startsWith(`http`));
}

function finiteNumber(value: number | null | undefined) {
	if (typeof value !== `number` || !Number.isFinite(value)) return undefined;
	return value;
}

function venueNameFromTitle(title: string | null | undefined) {
	const raw = title?.replace(/\s+/g, ` `).trim();
	if (!raw) return undefined;
	const match = raw.match(/\sat\s+(.+)$/i);
	const venue = match?.[1]?.trim();
	if (!venue) return undefined;
	if (/^(bali|tonight|the|a|an)$/i.test(venue)) return undefined;
	return venue;
}

function firstArtistHandle(artists: string[] | null | undefined) {
	if (!artists?.length) return undefined;
	for (const entry of artists) {
		const handle = nonempty(entry);
		if (handle) return handle;
	}
	return undefined;
}

function toInstagramUrl(value: string | null | undefined) {
	const raw = nonempty(value);
	if (!raw) return undefined;
	if (raw.startsWith(`http`)) return raw;
	const username = raw
		.replace(/^@/, ``)
		.replace(/^(www\.)?instagram\.com\//i, ``)
		.replace(/\/$/, ``);
	if (!username) return undefined;
	return `https://instagram.com/${username}`;
}

function toWhatsappUrl(value: string | null | undefined) {
	const raw = nonempty(value);
	if (!raw) return undefined;
	if (/^https?:\/\/(www\.)?(wa\.me|api\.whatsapp\.com)\//i.test(raw)) return raw;

	const digits = raw.replace(/\D/g, ``);
	if (!digits) return undefined;
	return `https://wa.me/${digits}`;
}

function toMakassarIso(value: string | null | undefined) {
	const raw = nonempty(value);
	if (!raw) return undefined;
	const date = new Date(raw);
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

type SeeVenue = {
	name: string | null;
	address: string | null;
	area: string | null;
};

type SeeEventRow = {
	id_event: string;
	title: string | null;
	slug: string | null;
	date_time: string | null;
	end_date_time: string | null;
	description: string | null;
	image_url: string | null;
	image_top_url: string | null;
	image_share_url: string | null;
	categories: string[] | null;
	price: string | null;
	latitude: number | null;
	longitude: number | null;
	area: string | null;
	address_override: string | null;
	ticket_buy_url: string | null;
	event_instagram_url: string | null;
	artists_links: string[] | null;
	music_genre: string | null;
	whatsapp_number_override: string | null;
	review_status: string | null;
	market: string | null;
	venues: SeeVenue | null;
};
