/**
 * Scrapes Event by Indonesia (eventbyindonesia.id / EventByID) via the public
 * Kemenpar API at api-event.kemenpar.go.id. Lists Bali upcoming events, then
 * enriches each slug from the detail endpoint. Origin must be
 * https://event.kemenpar.go.id or the API returns 403.
 *
 * Usage:
 *   bun run scripts/scrape-eventbyindonesia.ts
 *   bun run scripts/scrape-eventbyindonesia.ts --limit 5
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
import { hasValidCoordinates } from "../src/lib/locationFilter.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";
import { resizeCoverImage } from "../src/lib/imageProcessing.ts";
import * as assets from "../src/lib/assets.ts";
import { parseCliArgs } from "./scrape-eventbrite.ts";

const API_BASE = `https://api-event.kemenpar.go.id`;
const SITE_BASE = `https://eventbyindonesia.id`;
const API_ORIGIN = `https://event.kemenpar.go.id`;
const SOURCE = `eventbyindonesia` as const;
const TIME_ZONE = `Asia/Makassar` as const;
const BALI_PROVINCE_ID = 51;
const PER_PAGE = 50;
const MAX_PAGES = 50;
const MAX_IMAGES = 3;
const UPCOMING_GRACE_MS = 24 * 60 * 60 * 1000;
const GEOCODE_BIAS = [`Bali`, `Indonesia`];

const API_HEADERS = {
	Origin: API_ORIGIN,
	Referer: `${API_ORIGIN}/events`,
	Accept: `application/json`,
};

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(_query?: string, limit?: number): Promise<ScrapedEvent[]> {
		console.error(
			`Fetching Event by Indonesia (Bali upcoming)${limit != null ? ` (limit ${limit})` : ``}...`,
		);

		const listings = await fetchBaliUpcomingListings();
		console.error(`Listed ${listings.length} Bali upcoming events`);

		const kept: ScrapedEvent[] = [];
		const seen = new Set<string>();
		const now = Date.now();

		for (const listing of listings) {
			if (limit != null && kept.length >= limit) break;
			try {
				await sleep(REQUEST_DELAY_MS);
				const detail = await fetchEventDetail(listing.slug);
				if (!detail) {
					console.error(`No detail for ${listing.slug}`);
					continue;
				}

				const mapped = await mapEventDetail(detail);
				if (!mapped) continue;
				if (!isUpcomingStart({ startAt: mapped.startAt, now })) continue;
				if (seen.has(mapped.sourceUrl)) continue;
				seen.add(mapped.sourceUrl);
				kept.push(mapped);
			} catch (error) {
				console.error(`Failed to process ${listing.slug} (${listing.name}):`, error);
			}
		}

		kept.sort((a, b) => a.startAt.localeCompare(b.startAt));
		// Presigned CDN URLs expire in ~1h; other scrapers may still be running when
		// scrape-websites calls cacheImages, so upload durable copies before return.
		for (const event of kept) {
			try {
				event.imageUrls = await makeImagesDurable({
					sourceUrl: event.sourceUrl,
					imageUrls: event.imageUrls,
				});
			} catch (error) {
				console.error(`Durable images failed for ${event.sourceUrl}:`, error);
			}
		}

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

export function isUpcomingStart({ startAt, now }: { startAt: string; now: number }): boolean {
	const start = new Date(startAt).getTime();
	if (Number.isNaN(start)) return false;
	return start >= now - UPCOMING_GRACE_MS;
}

export async function mapEventDetail(detail: EventDetail): Promise<ScrapedEvent | undefined> {
	const name = getName(detail);
	const startAt = getStartAt(detail);
	const sourceUrl = getSourceUrl(detail);
	if (!name || !startAt || !sourceUrl) return undefined;

	const address = getAddress(detail);
	const point = await resolvePoint(detail);

	return {
		name,
		description: getDescription(detail),
		imageUrls: getImageUrls(detail),
		startAt,
		endAt: getEndAt(detail),
		address,
		price: getPrice(detail),
		priceIsHtml: false,
		host: getHost(detail),
		hostLink: getHostLink(detail),
		contact: getContact(detail),
		latitude: point?.lat,
		longitude: point?.lng,
		timezone: TIME_ZONE,
		tags: getTags(detail),
		sourceUrl,
		source: SOURCE,
	};
}

export function parseListPage(body: unknown, expectedPage: number): ListPage {
	if (!body || typeof body !== `object`) throw new Error(`EBI list page ${expectedPage} was not an object`);
	const root = body as { data?: unknown };
	const wrapper = root.data;
	if (!wrapper || typeof wrapper !== `object`) throw new Error(`EBI list page ${expectedPage} has no data`);
	const record = wrapper as { data?: unknown; meta?: unknown };
	if (!Array.isArray(record.data)) throw new Error(`EBI list page ${expectedPage} has no rows`);
	const meta = record.meta;
	if (!meta || typeof meta !== `object`) throw new Error(`EBI list page ${expectedPage} has no meta`);
	const metaRecord = meta as { current_page?: unknown; last_page?: unknown; total?: unknown };
	const currentPage = readNumber(metaRecord.current_page);
	const lastPage = readNumber(metaRecord.last_page);
	const total = readNumber(metaRecord.total);
	if (currentPage == null || lastPage == null || total == null) {
		throw new Error(`EBI list page ${expectedPage} has incomplete meta`);
	}
	if (currentPage !== expectedPage) {
		throw new Error(`EBI list page ${expectedPage} came back as ${currentPage}`);
	}

	const listings: EventListing[] = [];
	for (const row of record.data) {
		const listing = parseListing(row);
		if (!listing) continue;
		listings.push(listing);
	}
	return { currentPage, lastPage, total, listings };
}

export function parseEventDetail(body: unknown): EventDetail | undefined {
	if (!body || typeof body !== `object`) return undefined;
	const data = (body as { data?: unknown }).data;
	if (!data || typeof data !== `object`) return undefined;
	const record = data as Record<string, unknown>;
	const slug = readText(record.slug)?.trim();
	if (!slug) return undefined;

	return {
		name: readText(record.name)?.trim() || ``,
		nameEn: readText(record.name_en)?.trim(),
		slug,
		startEvent: readText(record.start_event)?.trim() || ``,
		endEvent: readText(record.end_event)?.trim(),
		startTime: readText(record.start_time)?.trim(),
		endTime: readText(record.end_time)?.trim(),
		cityName: readText(record.city_name)?.trim(),
		provinceName: readText(record.province_name)?.trim(),
		descriptionHtml: readText(record.description_en) || readText(record.description),
		payment: readText(record.payment)?.trim(),
		instagramLink: readText(record.instagram_link)?.trim(),
		moreInfoLink: readText(record.more_info_link)?.trim(),
		ticketLinks: readTicketLinks(record.ticket_links),
		latitude: readNumber(record.latitude),
		longitude: readNumber(record.longitude),
		image: readText(record.image)?.trim(),
		thumbnailUrl: readText(record.thumbnail_url)?.trim(),
		galleryImages: readGalleryUrls(record.images),
		eventCategory: readText(record.event_category)?.trim(),
		eventType: readText(record.event_type)?.trim(),
		partnerships: readPartnershipNames(record.partnerships),
	};
}

function getName(detail: EventDetail): string | undefined {
	const name = detail.nameEn?.trim() || detail.name.trim();
	return name || undefined;
}

function getStartAt(detail: EventDetail): string | undefined {
	return wallDateTimeToIso({ date: detail.startEvent, time: detail.startTime });
}

function getEndAt(detail: EventDetail): string | undefined {
	const endDate = detail.endEvent || detail.startEvent;
	return wallDateTimeToIso({ date: endDate, time: detail.endTime || detail.startTime });
}

function getAddress(detail: EventDetail): string[] {
	const lines = [detail.cityName, detail.provinceName, `Indonesia`]
		.map((line) => line?.trim())
		.filter((line): line is string => Boolean(line));
	return [...new Set(lines)];
}

function getPrice(detail: EventDetail): string | undefined {
	const payment = detail.payment?.toUpperCase();
	if (payment === `FREE`) return `Free`;
	if (payment === `PAID`) return `Paid`;
	return undefined;
}

function getDescription(detail: EventDetail): string | undefined {
	const description = cleanProseHtml(detail.descriptionHtml);
	const trimmed = description?.trim();
	return trimmed || undefined;
}

export function getImageUrls(detail: EventDetail): string[] {
	const urls: string[] = [];
	const seenPaths = new Set<string>();

	const push = (url: string | undefined) => {
		if (!url?.startsWith(`http`)) return;
		if (urls.length >= MAX_IMAGES) return;
		const pathKey = imagePathKey(url);
		if (seenPaths.has(pathKey)) return;
		seenPaths.add(pathKey);
		urls.push(url);
	};

	// Banner first, then gallery. Thumbnail only if nothing else (same asset, smaller).
	push(detail.image);
	for (const url of detail.galleryImages) push(url);
	if (!urls.length) push(detail.thumbnailUrl);
	return urls;
}

/** Strip signed query so cache keys stay stable across refreshes. */
export function stableImageUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.search = ``;
		parsed.hash = ``;
		return parsed.toString();
	} catch {
		return url.split(`?`)[0] || url;
	}
}

function imagePathKey(url: string): string {
	try {
		const path = new URL(stableImageUrl(url)).pathname;
		return path.replace(/\/thumbnails\/\d+\//, `/`);
	} catch {
		return stableImageUrl(url);
	}
}

async function makeImagesDurable({
	sourceUrl,
	imageUrls,
}: {
	sourceUrl: string;
	imageUrls: string[];
}): Promise<string[]> {
	if (!imageUrls?.length) return [];

	const sourceSlug = sourceSlugFromUrl(sourceUrl);
	const uploadSlug = sourceSlug ? `eventbyindonesia-${sourceSlug}` : `eventbyindonesia`;

	const freshByPath = new Map<string, string>();
	if (sourceSlug) {
		try {
			await sleep(REQUEST_DELAY_MS);
			const detail = await fetchEventDetail(sourceSlug);
			if (detail) {
				for (const url of getImageUrls(detail)) {
					freshByPath.set(imagePathKey(url), url);
				}
			}
		} catch (error) {
			console.error(`Fresh detail for images failed (${sourceSlug}):`, error);
		}
	}

	const durable: string[] = [];
	for (const url of imageUrls.slice(0, MAX_IMAGES)) {
		const pathKey = imagePathKey(url);
		const signed = freshByPath.get(pathKey) ?? url;
		try {
			durable.push(await uploadDurableImage({ signedUrl: signed, uploadSlug }));
		} catch (error) {
			console.error(`Upload durable image failed for ${stableImageUrl(signed)}:`, error);
			// Fresh signature may still work if this source is scraped alone.
			durable.push(signed);
		}
	}
	return durable;
}

async function uploadDurableImage({
	signedUrl,
	uploadSlug,
}: {
	signedUrl: string;
	uploadSlug: string;
}): Promise<string> {
	const bytes = await customFetch(signedUrl, { returnType: `bytes` });
	const { buffer, phash } = await resizeCoverImage(bytes);
	return assets.uploadEventImage(buffer, uploadSlug, phash, assets.loadCreds());
}

function sourceSlugFromUrl(sourceUrl: string): string | undefined {
	try {
		const path = new URL(sourceUrl).pathname;
		const match = /\/event\/([^/]+)\/?$/.exec(path);
		return match?.[1] || undefined;
	} catch {
		return undefined;
	}
}

function getHost(detail: EventDetail): string | undefined {
	// created_by_name is a CMS editor, not the organizer.
	const partner = detail.partnerships.find((name) => name.trim());
	return partner || undefined;
}

function getHostLink(detail: EventDetail): string | undefined {
	const instagram = detail.instagramLink?.trim();
	if (instagram?.startsWith(`http`)) return instagram;
	if (instagram) {
		const username = instagram.replace(/^@/, ``);
		if (username) return `https://instagram.com/${username}`;
	}
	return undefined;
}

function getContact(detail: EventDetail): string[] {
	const contacts: string[] = [];
	for (const url of [detail.moreInfoLink, ...detail.ticketLinks]) {
		const trimmed = url?.trim();
		if (!trimmed?.startsWith(`http`)) continue;
		if (contacts.includes(trimmed)) continue;
		contacts.push(trimmed);
	}
	return contacts;
}

function getTags(detail: EventDetail): string[] {
	const tags: string[] = [];
	for (const value of [detail.eventCategory, detail.eventType]) {
		const tag = value?.trim();
		if (!tag) continue;
		if (tags.includes(tag)) continue;
		tags.push(tag);
	}
	return tags;
}

function getSourceUrl(detail: EventDetail): string | undefined {
	if (!detail.slug) return undefined;
	return `${SITE_BASE}/event/${detail.slug}`;
}

async function resolvePoint(detail: EventDetail): Promise<{ lat: number; lng: number } | undefined> {
	if (hasValidCoordinates({ lat: detail.latitude, lng: detail.longitude })) {
		return { lat: detail.latitude!, lng: detail.longitude! };
	}

	const addressLines = getAddress(detail);
	if (!addressLines.length) return undefined;

	const apiKey = process.env.GOOGLE_MAPS_API_KEY || ``;
	if (!apiKey) return undefined;

	try {
		const geocoded = await geocodeAddressCached({
			addressLines,
			apiKey,
			biasAddressLines: GEOCODE_BIAS,
		});
		if (!geocoded || !hasValidCoordinates({ lat: geocoded.lat, lng: geocoded.lng })) return undefined;
		return { lat: geocoded.lat, lng: geocoded.lng };
	} catch (error) {
		console.error(`Geocode failed for ${detail.slug}:`, error);
		return undefined;
	}
}

async function fetchBaliUpcomingListings(): Promise<EventListing[]> {
	const first = await fetchListPage(1);
	if (first.lastPage < 1 || first.lastPage > MAX_PAGES) {
		throw new Error(`EBI list last_page ${first.lastPage} is out of range`);
	}

	const pages = [first.listings];
	for (let page = 2; page <= first.lastPage; page++) {
		await sleep(REQUEST_DELAY_MS);
		pages.push((await fetchListPage(page)).listings);
	}
	return uniqueListings(pages.flat());
}

async function fetchListPage(page: number): Promise<ListPage> {
	const params = new URLSearchParams({
		province: String(BALI_PROVINCE_ID),
		only_upcoming: `1`,
		per_page: String(PER_PAGE),
		page: String(page),
	});
	const body = await customFetch(`${API_BASE}/api/events?${params}`, {
		returnType: `json`,
		headers: API_HEADERS,
	});
	return parseListPage(body, page);
}

async function fetchEventDetail(slug: string): Promise<EventDetail | undefined> {
	const body = await customFetch(`${API_BASE}/api/events/${encodeURIComponent(slug)}`, {
		returnType: `json`,
		headers: API_HEADERS,
	});
	return parseEventDetail(body);
}

function parseListing(row: unknown): EventListing | undefined {
	if (!row || typeof row !== `object`) return undefined;
	const record = row as Record<string, unknown>;
	const slug = readText(record.slug)?.trim();
	const name = readText(record.name)?.trim();
	if (!slug || !name) return undefined;
	return { slug, name };
}

function uniqueListings(listings: readonly EventListing[]): EventListing[] {
	return [...new Map(listings.map((listing) => [listing.slug, listing])).values()];
}

function wallDateTimeToIso({
	date,
	time,
}: {
	date: string | undefined;
	time: string | undefined;
}): string | undefined {
	if (!date) return undefined;
	const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
	if (!dateMatch) return undefined;
	const year = Number(dateMatch[1]);
	const month = Number(dateMatch[2]);
	const day = Number(dateMatch[3]);

	let hour = 0;
	let minute = 0;
	if (time) {
		const timeMatch = /^(\d{1,2}):(\d{2})/.exec(time.trim());
		if (timeMatch) {
			hour = Number(timeMatch[1]);
			minute = Number(timeMatch[2]);
		}
	}

	if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;
	return dateToIsoStr(year, month, day, hour, minute, TIME_ZONE, false);
}

function readTicketLinks(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const links: string[] = [];
	for (const item of value) {
		if (typeof item === `string`) {
			const trimmed = item.trim();
			if (trimmed.startsWith(`http`)) links.push(trimmed);
			continue;
		}
		if (!item || typeof item !== `object`) continue;
		const record = item as Record<string, unknown>;
		for (const key of [`url`, `link`, `href`]) {
			const url = readText(record[key])?.trim();
			if (url?.startsWith(`http`)) {
				links.push(url);
				break;
			}
		}
	}
	return links;
}

function readGalleryUrls(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const urls: string[] = [];
	for (const item of value) {
		if (!item || typeof item !== `object`) continue;
		const url = readText((item as Record<string, unknown>).url)?.trim();
		if (url?.startsWith(`http`)) urls.push(url);
	}
	return urls;
}

function readPartnershipNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const item of value) {
		if (!item || typeof item !== `object`) continue;
		const record = item as Record<string, unknown>;
		const name = readText(record.name)?.trim() || readText(record.organization_name)?.trim();
		if (name) names.push(name);
	}
	return names;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value === `string` && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function readText(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	return value;
}

if (import.meta.main) {
	try {
		const { limit } = parseCliArgs();
		const events = await new WebsiteScraper().scrapeWebsite(undefined, limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

type EventListing = {
	slug: string;
	name: string;
};

type ListPage = {
	currentPage: number;
	lastPage: number;
	total: number;
	listings: EventListing[];
};

type EventDetail = {
	name: string;
	nameEn: string | undefined;
	slug: string;
	startEvent: string;
	endEvent: string | undefined;
	startTime: string | undefined;
	endTime: string | undefined;
	cityName: string | undefined;
	provinceName: string | undefined;
	descriptionHtml: string | undefined;
	payment: string | undefined;
	instagramLink: string | undefined;
	moreInfoLink: string | undefined;
	ticketLinks: string[];
	latitude: number | undefined;
	longitude: number | undefined;
	image: string | undefined;
	thumbnailUrl: string | undefined;
	galleryImages: string[];
	eventCategory: string | undefined;
	eventType: string | undefined;
	partnerships: string[];
};
