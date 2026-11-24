/**
 * Scrapes bali.live events via their public REST API
 * (`GET /api/v1/events` listing + `/api/v1/events/{slug}` detail).
 * Multi-day listings expand into one ScrapedEvent per future occurrence.
 * Names are filtered with the whitelist/blacklist.
 *
 * Usage:
 *   bun run scripts/scrape-balilive.ts
 *   bun run scripts/scrape-balilive.ts --limit 10
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

const SITE_BASE = `https://bali.live`;
const API_BASE = `https://api.bali.live/api/v1`;
const SOURCE = `balilive` as const;
const TIMEZONE = `Asia/Makassar` as const;
const OCCURRENCE_DAYS_AHEAD = 90;
const UPCOMING_GRACE_MS = 6 * 60 * 60 * 1000;
const GENERIC_HOSTS = new Set([`admin`, `administrator`, `bali.live`, `bali live`]);
const RUNNER_FLAGS = new Set([`--clean`, `--dry-run`, `--write-baseline`, `--exclude`, `--log-dir`]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Bali Live events via API${resolvedLimit != null ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		const rangeStart = startOfLocalDay(new Date(), TIMEZONE);
		const rangeEnd = addDays(rangeStart, OCCURRENCE_DAYS_AHEAD);
		const listings = await fetchEventListings({ rangeStart, rangeEnd });
		console.error(`Listed ${listings.length} events in date window.`);

		const candidates = listings.filter((item) => passesNameLists(getName(item)));
		console.error(`${candidates.length} titles match whitelist/blacklist.`);

		const scraped: ScrapedEvent[] = [];
		const seen = new Set<string>();
		const nowMs = Date.now() - UPCOMING_GRACE_MS;

		for (const listing of candidates) {
			if (resolvedLimit != null && scraped.length >= resolvedLimit) break;
			try {
				await sleep(REQUEST_DELAY_MS);
				const detail = await fetchEventDetail(listing.slug);
				const event = detail ?? listing;
				const mapped = mapBaliLiveEvent({
					event,
					rangeStart,
					rangeEnd,
					nowMs,
				});
				for (const item of mapped) {
					const key = `${normalizeKey(item.name)}|${item.startAt}`;
					if (seen.has(key)) continue;
					seen.add(key);
					scraped.push(item);
					if (resolvedLimit != null && scraped.length >= resolvedLimit) break;
				}
			} catch (error) {
				console.error(`Failed to process Bali Live event ${listing.slug}:`, error);
			}
		}

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

export function mapBaliLiveEvent({
	event,
	rangeStart,
	rangeEnd,
	nowMs,
}: {
	event: BaliLiveEvent;
	rangeStart: Date;
	rangeEnd: Date;
	nowMs: number;
}): ScrapedEvent[] {
	const name = getName(event);
	const sourceUrl = getSourceUrl(event);
	if (!name || !sourceUrl) return [];
	if (!passesNameLists(name)) return [];

	const occurrences = getOccurrences({ event, rangeStart, rangeEnd, nowMs });
	if (!occurrences?.length) return [];

	const description = getDescription(event);
	const address = getAddress(event);
	const price = getPrice(event);
	const imageUrls = getImageUrls(event);
	const host = getHost(event);
	const hostLink = getHostLink(event);
	const contact = getContact(event);
	const tags = getTags(event);
	const latitude = getLatitude(event);
	const longitude = getLongitude(event);

	const events: ScrapedEvent[] = [];
	for (const occurrence of occurrences) {
		try {
			events.push({
				name,
				startAt: occurrence.startAt,
				endAt: occurrence.endAt,
				timezone: TIMEZONE,
				address,
				price,
				priceIsHtml: false,
				description,
				imageUrls,
				host,
				hostLink,
				contact,
				latitude,
				longitude,
				tags,
				sourceUrl,
				source: SOURCE,
			} satisfies ScrapedEvent);
		} catch (error) {
			console.error(`Failed to map occurrence for ${sourceUrl}:`, error);
		}
	}
	return events;
}

export function getName(event: BaliLiveEvent | undefined): string | undefined {
	const title = decodeEntities(event?.title)?.replace(/\s+/g, ` `).trim();
	return title || undefined;
}

export function getDescription(event: BaliLiveEvent | undefined): string | undefined {
	const blocks = event?.content?.blocks;
	if (blocks?.length) {
		const parts: string[] = [];
		for (const block of blocks) {
			const html = blockToHtml(block);
			if (html) parts.push(html);
		}
		if (parts?.length) return cleanProseHtml(parts.join(``)) || undefined;
	}

	const meta = decodeEntities(event?.metaDescription)?.trim();
	if (!meta) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(meta)}</p>`) || undefined;
}

export function getAddress(event: BaliLiveEvent | undefined): string[] {
	const place = event?.place;
	const lines: string[] = [];
	const title = decodeEntities(place?.title)?.trim();
	if (title) lines.push(title);

	const address = decodeEntities(place?.location?.address)?.trim();
	if (address && !lines.some((line) => line.toLowerCase() === address.toLowerCase())) {
		lines.push(address);
	}

	const district = decodeEntities(place?.districtName)?.trim();
	if (district && !lines.some((line) => line.toLowerCase().includes(district.toLowerCase()))) {
		lines.push(district);
	}

	if (!lines?.length) lines.push(`Bali`);
	return lines;
}

export function getPrice(event: BaliLiveEvent | undefined): string | undefined {
	const entry = event?.entry?.trim().toLowerCase();
	if (entry === `free`) return `Free`;
	if (entry === `paid`) return `Paid`;
	return undefined;
}

export function getImageUrls(event: BaliLiveEvent | undefined): string[] {
	const urls: string[] = [];
	const push = (url: string | null | undefined) => {
		const trimmed = url?.trim();
		if (!trimmed) return;
		if (!trimmed.startsWith(`http://`) && !trimmed.startsWith(`https://`)) return;
		if (urls.includes(trimmed)) return;
		urls.push(trimmed);
	};

	for (const media of event?.media?.content ?? []) {
		push(media.originalUrl);
		push(media.previewUrl);
	}
	for (const image of event?.images ?? []) {
		push(image.previewUrl);
	}
	push(event?.desktopPreview?.previewUrl);
	push(event?.mobilePreview?.previewUrl);
	return urls;
}

export function getHost(event: BaliLiveEvent | undefined): string | undefined {
	const name = decodeEntities(event?.createdBy?.name)?.trim();
	if (!name) return undefined;
	if (GENERIC_HOSTS.has(name.toLowerCase())) return undefined;
	return name;
}

export function getHostLink(event: BaliLiveEvent | undefined): string | undefined {
	const slug = event?.place?.slug?.trim();
	if (!slug) return undefined;
	return `${SITE_BASE}/places/${slug}`;
}

export function getContact(event: BaliLiveEvent | undefined): string[] {
	const contacts: string[] = [];
	const instagram = event?.place?.instagram?.trim();
	if (instagram) {
		if (instagram.startsWith(`http://`) || instagram.startsWith(`https://`)) {
			contacts.push(instagram);
		} else {
			const handle = instagram.replace(/^@/, ``);
			if (handle) contacts.push(`https://www.instagram.com/${handle}`);
		}
	}

	const haystack = contactHaystack(event);
	const whatsappMatch = haystack.match(/(?:whatsapp|wa)[:\s]*\+?([\d\s\-()]{8,})/i);
	if (whatsappMatch?.[1]) {
		const digits = whatsappMatch[1].replace(/\D/g, ``);
		if (digits.length >= 8) contacts.push(`https://api.whatsapp.com/send?phone=${digits}`);
	}

	return [...new Set(contacts)];
}

export function getTags(event: BaliLiveEvent | undefined): string[] {
	const tags: string[] = [];
	for (const type of event?.types ?? []) {
		const name = decodeEntities(type?.name)?.trim();
		if (!name) continue;
		if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) continue;
		tags.push(name);
	}
	return tags;
}

export function getSourceUrl(event: BaliLiveEvent | undefined): string | undefined {
	const slug = event?.slug?.trim();
	if (!slug) return undefined;
	return `${SITE_BASE}/events/${slug}`;
}

export function getLatitude(event: BaliLiveEvent | undefined): number | null {
	const lat = event?.place?.location?.lat;
	return Number.isFinite(lat) ? Number(lat) : null;
}

export function getLongitude(event: BaliLiveEvent | undefined): number | null {
	const lng = event?.place?.location?.lng;
	return Number.isFinite(lng) ? Number(lng) : null;
}

export function passesNameLists(name: string | undefined): boolean {
	if (!name) return false;
	if (matchesBlackListWords(name)) return false;
	if (!matchesWhiteListWords(name)) return false;
	return true;
}

export function parseWallDateTime(value: string | null | undefined): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
} | undefined {
	if (!value?.trim()) return undefined;
	const match = value
		.trim()
		.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?/);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;
	return { year, month, day, hour, minute };
}

export function wallToIso(value: string | null | undefined): string | undefined {
	const parts = parseWallDateTime(value);
	if (!parts) return undefined;
	return dateToIsoStr(parts.year, parts.month, parts.day, parts.hour, parts.minute, TIMEZONE, false);
}

function getOccurrences({
	event,
	rangeStart,
	rangeEnd,
	nowMs,
}: {
	event: BaliLiveEvent;
	rangeStart: Date;
	rangeEnd: Date;
	nowMs: number;
}): { startAt: string; endAt: string | undefined }[] {
	const rangeStartMs = rangeStart.getTime();
	const rangeEndMs = rangeEnd.getTime();
	const occurrences: { startAt: string; endAt: string | undefined }[] = [];
	const seen = new Set<string>();

	for (const date of event.eventDates ?? []) {
		const startAt = wallToIso(date?.startAt);
		if (!startAt) continue;
		const startMs = Date.parse(startAt);
		if (!Number.isFinite(startMs)) continue;
		if (startMs < Math.max(rangeStartMs, nowMs)) continue;
		if (startMs > rangeEndMs) continue;

		let endAt = wallToIso(date?.endAt);
		if (endAt && endAt === startAt) endAt = undefined;
		if (endAt && Date.parse(endAt) < startMs) endAt = undefined;

		const key = `${startAt}|${endAt ?? ``}`;
		if (seen.has(key)) continue;
		seen.add(key);
		occurrences.push({ startAt, endAt });
	}

	return occurrences;
}

async function fetchEventListings({
	rangeStart,
	rangeEnd,
}: {
	rangeStart: Date;
	rangeEnd: Date;
}): Promise<BaliLiveEvent[]> {
	const events: BaliLiveEvent[] = [];
	const seen = new Set<number>();
	const dateStart = formatYmd(rangeStart, TIMEZONE);
	const dateEnd = formatYmd(rangeEnd, TIMEZONE);
	let page = 1;

	while (true) {
		const url = new URL(`${API_BASE}/events`);
		url.searchParams.set(`dateStart`, dateStart);
		url.searchParams.set(`dateEnd`, dateEnd);
		url.searchParams.set(`page`, String(page));

		const body = (await customFetch(url.toString(), {
			returnType: `json`,
			headers: { Accept: `application/json` },
		})) as BaliLiveListResponse;

		const pageItems = Array.isArray(body?.data) ? body.data : [];
		for (const item of pageItems) {
			if (!item?.id || seen.has(item.id)) continue;
			seen.add(item.id);
			events.push(item);
		}

		console.error(`  page ${page} — ${events.length} listings so far`);
		const lastPage = body?.meta?.last_page ?? page;
		if (page >= lastPage || !pageItems?.length) break;
		page++;
		await sleep(REQUEST_DELAY_MS);
	}

	return events;
}

async function fetchEventDetail(slug: string): Promise<BaliLiveEvent | undefined> {
	const trimmed = slug?.trim();
	if (!trimmed) return undefined;
	try {
		const body = (await customFetch(`${API_BASE}/events/${encodeURIComponent(trimmed)}`, {
			returnType: `json`,
			headers: { Accept: `application/json` },
		})) as BaliLiveDetailResponse;
		return body?.data;
	} catch (error) {
		console.error(`Detail fetch failed for ${trimmed}:`, error);
		return undefined;
	}
}

function blockToHtml(block: BaliLiveContentBlock | undefined): string | undefined {
	if (!block?.type) return undefined;
	const data = block.data ?? {};

	if (block.type === `paragraph` || block.type === `header`) {
		const text = decodeEntities(typeof data.text === `string` ? data.text : ``)?.trim() ?? ``;
		if (!text) return undefined;
		const tag = block.type === `header` ? `h3` : `p`;
		return `<${tag}>${text}</${tag}>`;
	}

	if (block.type === `list`) {
		const items = Array.isArray(data.items) ? data.items : [];
		const lis = items
			.map((item) => {
				const raw = typeof item === `string` ? item : typeof item?.content === `string` ? item.content : ``;
				const trimmed = decodeEntities(raw)?.trim() ?? ``;
				return trimmed ? `<li>${trimmed}</li>` : ``;
			})
			.filter(Boolean);
		if (!lis?.length) return undefined;
		const tag = data.style === `ordered` ? `ol` : `ul`;
		return `<${tag}>${lis.join(``)}</${tag}>`;
	}

	if (block.type === `quote`) {
		const text = decodeEntities(typeof data.text === `string` ? data.text : ``)?.trim() ?? ``;
		if (!text) return undefined;
		return `<blockquote><p>${text}</p></blockquote>`;
	}

	return undefined;
}

function contactHaystack(event: BaliLiveEvent | undefined): string {
	const parts: string[] = [];
	const meta = decodeEntities(event?.metaDescription);
	if (meta) parts.push(meta);
	for (const block of event?.content?.blocks ?? []) {
		const text = decodeEntities(typeof block?.data?.text === `string` ? block.data.text : ``);
		if (text) parts.push(text);
		for (const item of block?.data?.items ?? []) {
			const raw = typeof item === `string` ? item : typeof item?.content === `string` ? item.content : ``;
			const decoded = decodeEntities(raw);
			if (decoded) parts.push(decoded);
		}
	}
	return parts.join(`\n`);
}

function decodeEntities(value: string | null | undefined): string | undefined {
	if (value == null) return undefined;
	return value
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
		.replace(/&amp;/g, `&`)
		.replace(/&lt;/g, `<`)
		.replace(/&gt;/g, `>`)
		.replace(/&quot;/g, `"`)
		.replace(/&#39;/g, `'`)
		.replace(/&nbsp;/g, ` `)
		.replace(/&apos;/g, `'`)
		.replace(/&#43;/g, `+`);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, `&amp;`)
		.replace(/</g, `&lt;`)
		.replace(/>/g, `&gt;`)
		.replace(/"/g, `&quot;`);
}

function normalizeKey(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ` `).trim();
}

function formatYmd(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(date);
	const year = parts.find((part) => part.type === `year`)?.value;
	const month = parts.find((part) => part.type === `month`)?.value;
	const day = parts.find((part) => part.type === `day`)?.value;
	return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date, timeZone: string): Date {
	const ymd = formatYmd(date, timeZone);
	const [year, month, day] = ymd.split(`-`).map(Number);
	const iso = dateToIsoStr(year, month, day, 0, 0, timeZone, false);
	return new Date(iso);
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date.getTime());
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number } {
	let limit: number | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (RUNNER_FLAGS.has(arg)) continue;
		if (arg === `--limit`) {
			const value = Number(argv[i + 1]);
			if (Number.isFinite(value) && value > 0) limit = value;
			i++;
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			const value = Number(arg.slice(`--limit=`.length));
			if (Number.isFinite(value) && value > 0) limit = value;
		}
	}
	return { limit };
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite();
		console.log(JSON.stringify(events.slice(0, 3), null, 2));
		console.error(`Sampled ${Math.min(3, events.length)} of ${events.length} events.`);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type BaliLiveEvent = {
	id?: number;
	title?: string | null;
	slug?: string | null;
	entry?: string | null;
	metaDescription?: string | null;
	content?: { blocks?: BaliLiveContentBlock[] } | null;
	types?: { id?: number; name?: string | null }[] | null;
	eventDates?: { startAt?: string | null; endAt?: string | null }[] | null;
	createdBy?: { id?: number; name?: string | null; login?: string | null } | null;
	place?: BaliLivePlace | null;
	images?: { previewUrl?: string | null }[] | null;
	media?: { content?: { originalUrl?: string | null; previewUrl?: string | null }[] } | null;
	desktopPreview?: { previewUrl?: string | null } | null;
	mobilePreview?: { previewUrl?: string | null } | null;
};

type BaliLivePlace = {
	title?: string | null;
	slug?: string | null;
	districtName?: string | null;
	instagram?: string | null;
	location?: {
		lat?: number | null;
		lng?: number | null;
		address?: string | null;
		placeName?: string | null;
	} | null;
};

type BaliLiveContentBlock = {
	type?: string;
	data?: {
		text?: string;
		style?: string;
		items?: (string | { content?: string })[];
	};
};

type BaliLiveListResponse = {
	data?: BaliLiveEvent[];
	meta?: { last_page?: number; current_page?: number; total?: number };
};

type BaliLiveDetailResponse = {
	data?: BaliLiveEvent;
};
