/**
 * Scrapes FITRA (Bali wellness) via the public Supabase PostgREST API
 * (`events` joined with `event_hosts` / `gyms` / `vendors`).
 *
 * Usage:
 *   bun run scripts/scrape-fitra.ts
 *   bun run scripts/scrape-fitra.ts --limit 10
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	sleep,
} from "./common.ts";

const SITE_BASE = `https://fitra.asia`;
const SUPABASE_URL = `https://oeofpukhwfhqgmlubyoj.supabase.co`;
const SUPABASE_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lb2ZwdWtod2ZocWdtbHVieW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDU0MTcsImV4cCI6MjA5NDU4MTQxN30.Za5mdBWdMp0Zaek8eMi3KYO34iR4LdF6f08zeT1ldEo`;
const SOURCE = `fitra` as const;
const TIMEZONE = `Asia/Makassar`;
const PAGE_SIZE = 100;
const SELECT = [
	`id`,
	`name`,
	`description`,
	`category`,
	`location`,
	`location_name`,
	`location_lat`,
	`location_lng`,
	`starts_at`,
	`ends_at`,
	`payment_type`,
	`price_idr`,
	`cover_image_url`,
	`cover_images`,
	`external_registration_url`,
	`status`,
	`event_host:event_hosts(id,name,instagram,website,whatsapp)`,
	`gym_host:gyms!gym_host_id(id,name,instagram,website,whatsapp)`,
	`vendor_host:vendors!vendor_host_id(id,name,instagram,website,whatsapp)`,
].join(`,`);

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
			`Fetching FITRA events via Supabase${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let rows: FitraEvent[];
		try {
			rows = await fetchLiveEvents({ limit: resolvedLimit });
		} catch (error) {
			console.error(`Failed to fetch FITRA events:`, error);
			return [];
		}
		console.error(`Loaded ${rows.length} live upcoming events. Mapping...`);

		const events: ScrapedEvent[] = [];
		for (const row of rows) {
			try {
				const event = mapFitraEvent(row);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Failed to process event ${row?.id} (${row?.name}):`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const raw = await Bun.file(filePath).text();
				const rows = parsePayloadRows(raw);
				for (const row of rows) {
					try {
						const event = mapFitraEvent(row);
						if (event) events.push(event);
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
			const rows = parsePayloadRows(html);
			if (!rows?.length) return undefined;
			return mapFitraEvent(rows[0]);
		} catch (error) {
			console.error(`Error extracting event data:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName(firstRow(html));
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt(firstRow(html));
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt(firstRow(html));
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

export function mapFitraEvent(event: FitraEvent | undefined): ScrapedEvent | undefined {
	if (!event) return undefined;

	const name = getName(event);
	const startAt = getStartAt(event);
	const sourceUrl = getSourceUrl(event);
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${sourceUrl ?? event.id} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	if (!isUpcoming({ startAt, endAt: getEndAt(event) })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	return {
		name,
		startAt,
		endAt: getEndAt(event),
		timezone: TIMEZONE,
		address: getAddress(event),
		price: getPrice(event),
		priceIsHtml: false,
		description: getDescription(event),
		imageUrls: getImageUrls(event),
		host: getHost(event),
		hostLink: getHostLink(event),
		contact: getContact(event),
		latitude: getLatitude(event),
		longitude: getLongitude(event),
		tags: getTags(event),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export async function fetchLiveEvents({
	limit,
}: {
	limit?: number;
} = {}): Promise<FitraEvent[]> {
	const events: FitraEvent[] = [];
	const today = new Date().toISOString().slice(0, 10);
	let offset = 0;

	while (true) {
		const pageLimit = limit ? Math.min(PAGE_SIZE, limit - events.length) : PAGE_SIZE;
		if (pageLimit <= 0) break;

		const params = new URLSearchParams({
			select: SELECT,
			status: `eq.live`,
			or: `(starts_at.gte.${today},ends_at.gte.${today})`,
			order: `starts_at.asc`,
			limit: String(pageLimit),
			offset: String(offset),
		});

		const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
			headers: {
				apikey: SUPABASE_KEY,
				Authorization: `Bearer ${SUPABASE_KEY}`,
				Accept: `application/json`,
			},
		});
		if (!res.ok) {
			throw new Error(`FITRA events query failed: ${res.status} ${await res.text()}`);
		}

		const page = (await res.json()) as FitraEvent[];
		if (!page?.length) break;

		events.push(...page);
		console.error(`  offset ${offset} — ${events.length} events so far`);
		if (page.length < pageLimit) break;
		if (limit && events.length >= limit) break;

		offset += page.length;
		await sleep(100);
	}

	return limit ? events.slice(0, limit) : events;
}

export function getName(event: FitraEvent | undefined): string | undefined {
	const name = event?.name?.replace(/\s+/g, ` `).trim();
	return name || undefined;
}

export function getStartAt(event: FitraEvent | undefined): string | undefined {
	return normalizeIso(event?.starts_at);
}

export function getEndAt(event: FitraEvent | undefined): string | undefined {
	const startAt = getStartAt(event);
	const endAt = normalizeIso(event?.ends_at);
	if (!endAt) return undefined;
	if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
}

export function getAddress(event: FitraEvent | undefined): string[] {
	if (!event) return [];
	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | null | undefined) => {
		const text = raw?.replace(/\s+/g, ` `).trim();
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	push(event.location_name);
	push(event.location);
	if (!lines?.length) lines.push(`Bali`);
	return lines;
}

export function getPrice(event: FitraEvent | undefined): string | undefined {
	if (!event) return undefined;
	if (event.payment_type === `free` || event.price_idr === 0) return `Free`;
	if (event.price_idr == null || Number.isNaN(Number(event.price_idr))) {
		if (event.payment_type === `pay_at_door`) return `Pay at door`;
		return undefined;
	}
	return formatIdr(Number(event.price_idr));
}

export function getDescription(event: FitraEvent | undefined): string | undefined {
	const raw = event?.description?.trim();
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

export function getImageUrls(event: FitraEvent | undefined): string[] {
	if (!event) return [];
	const urls: string[] = [];
	const push = (raw: string | null | undefined) => {
		const url = raw?.trim();
		if (!url?.startsWith(`http`)) return;
		if (urls.includes(url)) return;
		urls.push(url);
	};

	push(event.cover_image_url);
	for (const url of event.cover_images ?? []) push(url);
	return urls;
}

export function getHost(event: FitraEvent | undefined): string | undefined {
	const host = resolveHost(event);
	const name = host?.name?.replace(/\s+/g, ` `).trim();
	return name || undefined;
}

export function getHostLink(event: FitraEvent | undefined): string | undefined {
	const host = resolveHost(event);
	return (
		toHttpUrl(host?.website) ||
		toInstagramUrl(host?.instagram) ||
		toHttpUrl(event?.external_registration_url) ||
		undefined
	);
}

export function getContact(event: FitraEvent | undefined): string[] {
	const contacts: string[] = [];
	const push = (raw: string | undefined) => {
		if (!raw) return;
		if (contacts.includes(raw)) return;
		contacts.push(raw);
	};

	const host = resolveHost(event);
	push(toHttpUrl(host?.website));
	push(toInstagramUrl(host?.instagram));
	push(toWhatsappUrl(host?.whatsapp));
	push(toHttpUrl(event?.external_registration_url));
	return contacts;
}

export function getLatitude(event: FitraEvent | undefined): number | null {
	return typeof event?.location_lat === `number` ? event.location_lat : null;
}

export function getLongitude(event: FitraEvent | undefined): number | null {
	return typeof event?.location_lng === `number` ? event.location_lng : null;
}

export function getTags(event: FitraEvent | undefined): string[] {
	const category = event?.category?.trim();
	return category ? [category] : [];
}

export function getSourceUrl(event: FitraEvent | undefined): string | undefined {
	const id = event?.id?.trim();
	if (!id) return undefined;
	return `${SITE_BASE}/events/${id}`;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (RUNNER_FLAGS.has(arg)) continue;
		if (arg === SOURCE) continue;

		if (arg === `--limit` || arg === `-n`) {
			const raw = argv[++i];
			const value = Number(raw);
			if (!raw || !Number.isFinite(value) || value < 1) {
				throw new Error(`Invalid --limit: ${raw}`);
			}
			limit = Math.floor(value);
			continue;
		}

		if (arg.startsWith(`--limit=`)) {
			const value = Number(arg.slice(`--limit=`.length));
			if (!Number.isFinite(value) || value < 1) {
				throw new Error(`Invalid --limit: ${arg}`);
			}
			limit = Math.floor(value);
			continue;
		}

		if (arg.startsWith(`-`)) continue;
		files.push(arg);
	}

	return { limit, files };
}

export function parsePayloadRows(raw: string): FitraEvent[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	const parsed = JSON.parse(trimmed) as FitraEvent | FitraEvent[];
	return Array.isArray(parsed) ? parsed : [parsed];
}

function firstRow(raw: string): FitraEvent | undefined {
	return parsePayloadRows(raw)[0];
}

function resolveHost(event: FitraEvent | undefined): FitraHost | undefined {
	if (!event) return undefined;
	return event.event_host || event.gym_host || event.vendor_host || undefined;
}

function isUpcoming({ startAt, endAt }: { startAt: string; endAt?: string }): boolean {
	const now = Date.now();
	const endMs = endAt ? Date.parse(endAt) : Number.NaN;
	if (Number.isFinite(endMs) && endMs >= now) return true;
	return Date.parse(startAt) >= now;
}

function normalizeIso(raw: string | null | undefined): string | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return undefined;
	return value;
}

function formatIdr(amount: number): string {
	if (amount >= 1000 && amount % 1000 === 0) {
		return `IDR ${amount / 1000}K`;
	}
	return `IDR ${Math.round(amount).toLocaleString(`en-US`)}`;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function toHttpUrl(raw: string | null | undefined): string | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (/^https?:\/\//i.test(value)) return value;
	if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
	return undefined;
}

function toInstagramUrl(raw: string | null | undefined): string | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (/^https?:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			const handle = url.pathname.split(`/`).filter(Boolean)[0];
			if (!handle) return value.split(`?`)[0];
			return `https://instagram.com/${handle}`;
		} catch {
			return value;
		}
	}
	const username = value.replace(/^@/, ``).replace(/^instagram\.com\//i, ``).replace(/\/$/, ``);
	if (!username) return undefined;
	return `https://instagram.com/${username}`;
}

function toWhatsappUrl(raw: string | null | undefined): string | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (/^https?:\/\/(www\.)?(wa\.me|api\.whatsapp\.com)\//i.test(value)) return value;
	const digits = value.replace(/\D/g, ``);
	if (!digits) return undefined;
	return `https://wa.me/${digits}`;
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

type FitraHost = {
	id?: string | null;
	name?: string | null;
	instagram?: string | null;
	website?: string | null;
	whatsapp?: string | null;
};

type FitraEvent = {
	id?: string | null;
	name?: string | null;
	description?: string | null;
	category?: string | null;
	location?: string | null;
	location_name?: string | null;
	location_lat?: number | null;
	location_lng?: number | null;
	starts_at?: string | null;
	ends_at?: string | null;
	payment_type?: string | null;
	price_idr?: number | null;
	cover_image_url?: string | null;
	cover_images?: string[] | null;
	external_registration_url?: string | null;
	status?: string | null;
	event_host?: FitraHost | null;
	gym_host?: FitraHost | null;
	vendor_host?: FitraHost | null;
};
