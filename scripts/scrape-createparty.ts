/**
 * Scrapes public events from create.party via GET /api/public-events.
 * Docs: https://create.party/api/public-events/doc
 *
 * Usage:
 *   bun run scripts/scrape-createparty.ts
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import { WebsiteScraperInterface, cleanProseHtml, customFetch } from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://create.party`;
const API_URL = `${SITE_BASE}/api/public-events`;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const SOURCE = `createparty` as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		console.error(`Fetching public events from create.party...`);
		const events = await fetchPublicEvents();
		console.error(`Found ${events.length} public events. Mapping...`);
		const scraped = await collectCreatePartyEvents(events);
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

/**
 * Maps each payload independently. A failure on one event does not stop the rest.
 */
export async function collectCreatePartyEvents(events: CreatePartyEvent[]): Promise<ScrapedEvent[]> {
	const scraped: ScrapedEvent[] = [];

	for (const event of events) {
		try {
			const mapped = mapCreatePartyEvent(event);
			if (!mapped) {
				console.error(`Skipping create.party event ${event?.id} due to missing name, start, or url.`);
				continue;
			}
			await fillCoordinates(mapped);
			scraped.push(mapped);
		} catch (error) {
			console.error(`Failed to process create.party event ${event?.id}:`, error);
		}
	}

	return scraped;
}

export function mapCreatePartyEvent(event: CreatePartyEvent): ScrapedEvent | undefined {
	const name = getName(event);
	const startAt = getStartAt(event);
	const sourceUrl = getSourceUrl(event);
	if (!name || !startAt || !sourceUrl) return undefined;

	return {
		name,
		startAt,
		endAt: getEndAt(event),
		timezone: getTimezone(event),
		address: getAddress(event),
		price: getPrice(event),
		priceIsHtml: getPriceIsHtml(event),
		description: getDescription(event),
		imageUrls: getImageUrls(event),
		host: getHost(event),
		hostLink: getHostLink(event),
		contact: getContact(event),
		latitude: getLatitude(event),
		longitude: getLongitude(event),
		tags: getTags(event),
		sourceUrl,
		source: getSource(event),
	};
}

function getName(event: CreatePartyEvent): string | undefined {
	if (typeof event?.name !== `string`) return undefined;
	const name = event.name.trim();
	return name || undefined;
}

function getStartAt(event: CreatePartyEvent): string | undefined {
	if (typeof event?.beginAt !== `string` || !event.beginAt.trim()) return undefined;
	const date = new Date(event.beginAt);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
}

function getEndAt(event: CreatePartyEvent): string | undefined {
	void event;
	return undefined;
}

function getTimezone(event: CreatePartyEvent): string | undefined {
	void event;
	return undefined;
}

function getAddress(event: CreatePartyEvent): string[] {
	if (typeof event?.location !== `string`) return [];
	return event.location
		.split(`,`)
		.map((part) => part.trim())
		.filter(Boolean);
}

function getPrice(event: CreatePartyEvent): string | undefined {
	const amounts = [finitePrice(event?.price), finitePrice(event?.maxPrice)].filter((amount): amount is number => amount != null);
	if (!amounts.length) return undefined;

	const low = Math.min(...amounts);
	const high = Math.max(...amounts);
	if (low === 0 && high === 0) return `Kostenlos`;
	if (low === high) return formatEuro(low);
	return `${formatAmount(low)} – ${formatAmount(high)}€`;
}

function getPriceIsHtml(event: CreatePartyEvent): boolean {
	void event;
	return false;
}

function getDescription(event: CreatePartyEvent): string | undefined {
	if (typeof event?.description !== `string`) return undefined;
	const raw = event.description.trim();
	if (!raw) return undefined;

	const html = raw
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join(``);
	return cleanProseHtml(html) || undefined;
}

function getImageUrls(event: CreatePartyEvent): string[] {
	if (typeof event?.coverImageUrl !== `string`) return [];
	const url = event.coverImageUrl.trim();
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return [];
	return [url];
}

function getHost(event: CreatePartyEvent): string | undefined {
	void event;
	return undefined;
}

function getHostLink(event: CreatePartyEvent): string | undefined {
	void event;
	return undefined;
}

function getContact(event: CreatePartyEvent): string[] {
	void event;
	return [];
}

function getLatitude(event: CreatePartyEvent): number | undefined {
	void event;
	return undefined;
}

function getLongitude(event: CreatePartyEvent): number | undefined {
	void event;
	return undefined;
}

function getTags(event: CreatePartyEvent): string[] {
	void event;
	return [];
}

function getSourceUrl(event: CreatePartyEvent): string | undefined {
	if (typeof event?.url === `string` && event.url.trim()) return event.url.trim();
	if (typeof event?.slug !== `string` || !event.slug.trim()) return undefined;
	return `${SITE_BASE}/e/${event.slug.trim()}`;
}

function getSource(event: CreatePartyEvent): ScrapedEvent[`source`] {
	void event;
	return SOURCE;
}

async function fetchPublicEvents(): Promise<CreatePartyEvent[]> {
	const events: CreatePartyEvent[] = [];
	const seenIds = new Set<string>();
	let start: string | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const url = new URL(API_URL);
		url.searchParams.set(`pageSize`, String(PAGE_SIZE));
		if (start) url.searchParams.set(`start`, start);

		const body = (await customFetch(url.toString(), { returnType: `json` })) as PublicEventsResponse;
		if (!Array.isArray(body?.events)) {
			throw new Error(`create.party public-events response is missing an events array`);
		}

		let added = 0;
		for (const event of body.events) {
			if (!event?.id || seenIds.has(event.id)) continue;
			seenIds.add(event.id);
			events.push(event);
			added++;
		}

		console.error(`  start ${start ?? body.start ?? `default`} — ${events.length} events so far`);
		const nextStart = nextPublicEventsStart({ start, events: body.events, pageSize: PAGE_SIZE });
		if (!nextStart || !added) break;
		start = nextStart;
	}

	return events;
}

/**
 * The endpoint has no cursor. When a page is full, ask again from the UTC day
 * of the last beginAt so later events on that day are not dropped.
 */
export function nextPublicEventsStart({
	start,
	events,
	pageSize,
}: {
	start?: string;
	events: CreatePartyEvent[];
	pageSize: number;
}): string | undefined {
	if (!events?.length || events.length < pageSize) return undefined;
	const lastDay = utcDay(events.at(-1)?.beginAt);
	if (!lastDay) return undefined;
	if (start && lastDay <= start) return undefined;
	return lastDay;
}

async function fillCoordinates(event: ScrapedEvent) {
	if (!event.address?.length) return;

	try {
		const geocoded = await geocodeAddressCached({
			addressLines: event.address,
			apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
		});
		if (!geocoded) return;
		event.latitude = geocoded.lat;
		event.longitude = geocoded.lng;
		event.timezone = geocoded.timezone;
	} catch (error) {
		console.error(`Geocoding failed for ${event.sourceUrl}:`, error);
	}
}

function finitePrice(value: number | null | undefined): number | undefined {
	if (typeof value !== `number`) return undefined;
	if (!Number.isFinite(value) || value < 0) return undefined;
	return value;
}

function formatAmount(amount: number) {
	return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(`.`, `,`);
}

function formatEuro(amount: number) {
	return `${formatAmount(amount)}€`;
}

function escapeHtml(text: string) {
	return text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`);
}

function utcDay(beginAt: string | null | undefined): string | undefined {
	if (!beginAt) return undefined;
	const date = new Date(beginAt);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString().slice(0, 10);
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		console.log(await scraper.scrapeWebsite());
	} catch (error) {
		console.error("Unhandled error in main execution:", error);
		process.exit(1);
	}
}

type CreatePartyEvent = {
	id: string;
	name: string;
	slug: string;
	beginAt: string | null;
	location: string | null;
	description: string | null;
	price: number | null;
	maxPrice: number | null;
	coverImageUrl: string | null;
	maxGuests: number | null;
	url: string;
};

type PublicEventsResponse = {
	pageSize: number;
	start: string;
	end: string | null;
	events: CreatePartyEvent[];
};
