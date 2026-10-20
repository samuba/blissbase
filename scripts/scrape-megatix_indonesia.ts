import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	sleep,
	REQUEST_DELAY_MS,
	selectLocationsByQuery,
} from "./common.ts";
import { LOCATIONS, type ScrapeLocation } from "./locations.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import { getDistanceInKm, hasValidCoordinates } from "../src/lib/locationFilter.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";
import { parseCliArgs } from "./scrape-eventbrite.ts";

const SEARCH_URL = `https://megatix.co.id/api/v2/events/search`;
const DETAIL_URL = `https://megatix.co.id/api/v3/events`;
const SOURCE = `megatix_indonesia` as const;
const RADIUS_KM = 30;
const TIME_ZONE = `Asia/Makassar` as const;
const GEOCODE_BIAS = [`Bali`, `Indonesia`];
const MAX_PAGES = 200;
const MAX_TOTAL = 2500;
const MAX_ITEM_FAILURE_SHARE = 0.5;
const UPCOMING_GRACE_MS = 24 * 60 * 60 * 1000;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(query?: string, limit?: number): Promise<ScrapedEvent[]> {
		const locations = megatixLocations(query);
		console.error(
			`Fetching Megatix Indonesia for ${locations.map((location) => location.name).join(`, `)}${limit != null ? ` (limit ${limit})` : ``}...`,
		);

		const hits = await fetchCompleteCatalog();
		const named = hits.filter((hit) => passesNameLists(getName(hit)));
		console.error(`Megatix catalog: ${hits.length} events, ${named.length} names match the word lists`);

		const kept: ScrapedEvent[] = [];
		const seen = new Set<string>();
		let itemFailures = 0;

		for (const hit of named) {
			if (limit != null && kept.length >= limit) break;
			try {
				await sleep(REQUEST_DELAY_MS);
				const detail = await fetchEventDetail(hit.id);
				if (!detail) {
					itemFailures++;
					console.error(`No Megatix detail for ${hit.id} (${hit.name})`);
					continue;
				}
				const point = await resolvePoint(detail);
				if (!point) {
					itemFailures++;
					console.error(`No coordinates for ${hit.name}`);
					continue;
				}
				if (!nearestLocation({ point, locations })) continue;

				const mapped = mapMegatixEvent({ hit, detail, point });
				if (!mapped) {
					itemFailures++;
					continue;
				}
				if (!isUpcomingStart({ startAt: mapped.startAt, now: Date.now() })) continue;
				if (seen.has(mapped.sourceUrl)) continue;
				seen.add(mapped.sourceUrl);
				kept.push(mapped);
			} catch (error) {
				itemFailures++;
				console.error(`Failed to process Megatix event ${hit.id} (${hit.name}):`, error);
			}
		}

		const stoppedEarly = limit != null && kept.length >= limit;
		if (!stoppedEarly && named.length && itemFailures / named.length > MAX_ITEM_FAILURE_SHARE) {
			throw new Error(
				`Megatix could not place ${itemFailures} of ${named.length} name matches. Check GOOGLE_MAPS_API_KEY and the geocode cache.`,
			);
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

export function megatixLocations(query?: string): ScrapeLocation[] {
	const indonesia = LOCATIONS.filter((location) => location.country === `Indonesia`);
	return selectLocationsByQuery({ locations: indonesia, query });
}

export function passesNameLists(name: string | undefined): boolean {
	if (!name) return false;
	if (!matchesWhiteListWords(name)) return false;
	if (matchesBlackListWords(name)) return false;
	return true;
}

export function nearestLocation({
	point,
	locations,
}: {
	point: { lat: number; lng: number };
	locations: readonly ScrapeLocation[];
}): ScrapeLocation | undefined {
	let best: { location: ScrapeLocation; km: number } | undefined;
	for (const location of locations) {
		const km = getDistanceInKm({
			fromLat: location.lat,
			fromLng: location.lon,
			toLat: point.lat,
			toLng: point.lng,
		});
		if (km > RADIUS_KM) continue;
		if (!best || km < best.km) best = { location, km };
	}
	return best?.location;
}

export function isUpcomingStart({ startAt, now }: { startAt: string; now: number }): boolean {
	const start = new Date(startAt).getTime();
	if (Number.isNaN(start)) return false;
	return start >= now - UPCOMING_GRACE_MS;
}

export function assembleCatalog({
	pages,
	total,
}: {
	pages: readonly { currentPage: number; hits: readonly SearchHit[] }[];
	total: number;
}): SearchHit[] {
	if (!pages.length) throw new Error(`Megatix catalog returned no pages`);

	const ids = new Set<number>();
	const hits: SearchHit[] = [];
	for (const [index, page] of pages.entries()) {
		if (page.currentPage !== index + 1) {
			throw new Error(`Megatix catalog page ${index + 1} came back as ${page.currentPage}`);
		}
		if (index < pages.length - 1 && !page.hits.length) {
			throw new Error(`Megatix catalog page ${page.currentPage} was empty`);
		}
		for (const hit of page.hits) {
			if (ids.has(hit.id)) continue;
			ids.add(hit.id);
			hits.push(hit);
		}
	}

	if (hits.length !== total) {
		throw new Error(`Megatix catalog has ${hits.length} events, expected ${total}`);
	}
	return hits;
}

export function mapMegatixEvent({
	hit,
	detail,
	point,
}: {
	hit: SearchHit;
	detail: EventDetail;
	point: { lat: number; lng: number };
}): ScrapedEvent | undefined {
	const name = getName(hit);
	const startAt = getStartAt(hit);
	const sourceUrl = getSourceUrl(hit);
	if (!name || !startAt || !sourceUrl) return undefined;

	return {
		name,
		description: getDescription(detail),
		imageUrls: getImageUrls(hit),
		startAt,
		endAt: getEndAt(hit),
		address: detail.addressLines,
		price: getPrice(hit),
		priceIsHtml: false,
		host: getHost(hit),
		hostLink: undefined,
		contact: [],
		latitude: point.lat,
		longitude: point.lng,
		timezone: TIME_ZONE,
		tags: [],
		sourceUrl,
		source: SOURCE,
	};
}

async function fetchCompleteCatalog(): Promise<SearchHit[]> {
	const first = await fetchUnfilteredSearchPage(1);
	if (first.lastPage < 1 || first.lastPage > MAX_PAGES) {
		throw new Error(`Megatix catalog last_page ${first.lastPage} is out of range`);
	}
	if (first.total < 0 || first.total > MAX_TOTAL) {
		throw new Error(`Megatix catalog total ${first.total} is out of range`);
	}

	const pages = [first];
	for (let page = 2; page <= first.lastPage; page++) {
		await sleep(REQUEST_DELAY_MS);
		const next = await fetchUnfilteredSearchPage(page);
		if (next.lastPage !== first.lastPage || next.currentPage !== page || next.total !== first.total) {
			throw new Error(`Megatix catalog page ${page} disagreed with page 1`);
		}
		pages.push(next);
		if (page % 25 === 0) console.error(`Megatix catalog page ${page}/${first.lastPage}`);
	}

	return assembleCatalog({ pages, total: first.total });
}

async function fetchUnfilteredSearchPage(page: number): Promise<SearchPage> {
	const body = await customFetch(`${SEARCH_URL}?page=${page}&search=`, { returnType: `json` });
	return parseSearchPage(body, page);
}

async function fetchEventDetail(id: number): Promise<EventDetail | undefined> {
	const body = await customFetch(`${DETAIL_URL}/${id}`, { returnType: `json` });
	return parseEventDetail(body);
}

async function resolvePoint(detail: EventDetail): Promise<{ lat: number; lng: number } | undefined> {
	if (detail.venuePoint) return detail.venuePoint;
	if (!detail.addressLines.length) return undefined;

	const geocoded = await geocodeAddressCached({
		addressLines: detail.addressLines,
		apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
		biasAddressLines: GEOCODE_BIAS,
	});
	if (!geocoded || !hasValidCoordinates({ lat: geocoded.lat, lng: geocoded.lng })) return undefined;
	return { lat: geocoded.lat, lng: geocoded.lng };
}

function parseSearchPage(body: unknown, expectedPage: number): SearchPage {
	if (!body || typeof body !== `object`) throw new Error(`Megatix search page ${expectedPage} was not an object`);
	const record = body as { data?: unknown; meta?: unknown };
	if (!Array.isArray(record.data)) throw new Error(`Megatix search page ${expectedPage} has no data`);
	const meta = record.meta;
	if (!meta || typeof meta !== `object`) throw new Error(`Megatix search page ${expectedPage} has no meta`);
	const metaRecord = meta as { current_page?: unknown; last_page?: unknown; total?: unknown };
	const currentPage = readNumber(metaRecord.current_page);
	const lastPage = readNumber(metaRecord.last_page);
	const total = readNumber(metaRecord.total);
	if (currentPage == null || lastPage == null || total == null) {
		throw new Error(`Megatix search page ${expectedPage} has incomplete meta`);
	}
	if (currentPage !== expectedPage) {
		throw new Error(`Megatix search page ${expectedPage} came back as ${currentPage}`);
	}

	const hits: SearchHit[] = [];
	for (const row of record.data) {
		const hit = parseSearchHit(row);
		if (!hit) continue;
		hits.push(hit);
	}
	return { currentPage, lastPage, total, hits };
}

function parseSearchHit(row: unknown): SearchHit | undefined {
	if (!row || typeof row !== `object`) return undefined;
	const record = row as Record<string, unknown>;
	const id = readNumber(record.id);
	const slug = readText(record.slug);
	if (id == null || !slug) return undefined;
	return {
		id,
		name: readText(record.name) ?? ``,
		slug,
		promoterName: readText(record.promoter_name),
		startDatetime: readText(record.start_datetime) ?? ``,
		endDatetime: readText(record.end_datetime),
		displayPrice: readText(record.display_price),
		coverUrl: readText(record.cover),
	};
}

export function parseEventDetail(body: unknown): EventDetail | undefined {
	if (!body || typeof body !== `object`) return undefined;
	const data = (body as { data?: unknown }).data;
	if (!data || typeof data !== `object`) return undefined;
	const record = data as Record<string, unknown>;
	const venue = record.venue && typeof record.venue === `object` ? (record.venue as Record<string, unknown>) : undefined;
	const venueName = readText(venue?.name);
	const fullAddress = readText(venue?.full_address);
	const parts =
		fullAddress
			?.split(`,`)
			.map((part) => part.trim())
			.filter(Boolean) ?? [];
	const addressLines = venueName && !parts.some((part) => part.toLowerCase() === venueName.toLowerCase()) ? [venueName, ...parts] : parts;
	const lat = readNumber(venue?.latitude);
	const lng = readNumber(venue?.longitude);
	const venuePoint = hasValidCoordinates({ lat, lng }) && lat != null && lng != null ? { lat, lng } : undefined;

	return {
		descriptionHtml: readText(record.description),
		addressLines,
		venuePoint,
	};
}

function getName(hit: SearchHit): string | undefined {
	const name = hit.name.trim();
	return name || undefined;
}

function getStartAt(hit: SearchHit): string | undefined {
	return wallTimeToIso(hit.startDatetime);
}

function getEndAt(hit: SearchHit): string | undefined {
	return wallTimeToIso(hit.endDatetime);
}

function getPrice(hit: SearchHit): string | undefined {
	const price = hit.displayPrice?.trim();
	return price || undefined;
}

function getImageUrls(hit: SearchHit): string[] {
	if (hit.coverUrl?.startsWith(`http`)) return [hit.coverUrl];
	return [];
}

function getHost(hit: SearchHit): string | undefined {
	const host = hit.promoterName?.trim();
	return host || undefined;
}

function getSourceUrl(hit: SearchHit): string | undefined {
	if (!hit.slug) return undefined;
	return `https://megatix.co.id/events/${hit.slug}`;
}

function getDescription(detail: EventDetail): string | undefined {
	const description = cleanProseHtml(detail.descriptionHtml);
	const trimmed = description?.trim();
	return trimmed || undefined;
}

function wallTimeToIso(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;
	return dateToIsoStr(year, month, day, hour, minute, TIME_ZONE, false);
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
		const { query, limit } = parseCliArgs();
		const events = await new WebsiteScraper().scrapeWebsite(query, limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

type SearchHit = {
	id: number;
	name: string;
	slug: string;
	promoterName: string | undefined;
	startDatetime: string;
	endDatetime: string | undefined;
	displayPrice: string | undefined;
	coverUrl: string | undefined;
};

type EventDetail = {
	descriptionHtml: string | undefined;
	addressLines: string[];
	venuePoint: { lat: number; lng: number } | undefined;
};

type SearchPage = {
	currentPage: number;
	lastPage: number;
	total: number;
	hits: SearchHit[];
};
