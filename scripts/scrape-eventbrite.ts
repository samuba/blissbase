/**
 * Scrapes upcoming Eventbrite events via the destination search API
 * (`POST https://www.eventbrite.com/api/v3/destination/search/`).
 * Eventbrite removed the documented public event search in 2019; this is
 * the JSON API the site itself uses. A `csrftoken` cookie from the homepage
 * response is enough — no private token.
 *
 * Search results only include a short `summary`. Full descriptions are
 * fetched per kept event from `/api/v3/events/{id}/description/`.
 *
 * Places come from `scripts/locations.ts`. Only entries with an Eventbrite
 * place id are searched. Names are kept when they match the Blissbase
 * whitelist and sit within 30km of that place.
 *
 * Usage:
 *   bun run scripts/scrape-eventbrite.ts
 *   bun run scripts/scrape-eventbrite.ts Germany
 *   bun run scripts/scrape-eventbrite.ts "Byron Bay"
 *   bun run scripts/scrape-eventbrite.ts --limit 10
 *   bun run scripts/scrape-eventbrite.ts Zürich --limit 5
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	sleep,
	REQUEST_DELAY_MS,
	selectLocationsByQuery,
} from "./common.ts";
import { LOCATIONS, eventbriteLocations, type ScrapeLocation } from "./locations.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SEARCH_URL = `https://www.eventbrite.com/api/v3/destination/search/`;
const DESCRIPTION_URL = (eventId: string) => `https://www.eventbrite.com/api/v3/events/${eventId}/description/`;
const SOURCE = `eventbrite` as const;
const PAGE_SIZE = 50;
const MAX_PAGES = 12;
const FULL_SCAN_MAX = 400;
const NARROW_QUERY_MAX = 1500;
const RADIUS_KM = 30;
const WINDOW_DAYS = 30;
/** Modest pools — enough to cut wall time, low enough to stay polite. */
const LOCATION_CONCURRENCY = 3;
const DESCRIPTION_CONCURRENCY = 4;
const BLACKLISTED_VENUES = [`soul dimension`];
// Queries the destination API actually narrows. Other terms (retreat, tantra, …)
// expand the result set past the place instead of filtering it.
const NARROW_QUERIES = [`meditation`, `breathwork`, `yoga`, `sound bath`];

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(query?: string, limit?: number): Promise<ScrapedEvent[]> {
		const locations = eventbriteLocations(selectLocationsByQuery({ locations: LOCATIONS, query }));
		if (!locations.length) throw new Error(`No Eventbrite place matches "${query?.trim()}"`);
		console.error(
			`Fetching upcoming Eventbrite events for ${locations.length} conscious places${query ? ` matching "${query}"` : ``}${limit != null ? ` (limit ${limit})` : ``} (locations×${LOCATION_CONCURRENCY}, descriptions×${DESCRIPTION_CONCURRENCY})...`,
		);
		const session: SearchSession = { csrfToken: await getCsrfToken() };
		const from = isoDay(-1);
		const to = isoDay(WINDOW_DAYS);
		const candidates: DescriptionCandidate[] = [];
		const seen = new Set<string>();
		let failedLocations = 0;

		await mapPool({
			items: locations,
			concurrency: LOCATION_CONCURRENCY,
			mapper: async (location) => {
				if (limit != null && candidates.length >= limit) return;
				try {
					const events = await fetchLocationEvents({ session, location, from, to });
					let kept = 0;
					for (const event of events) {
						if (limit != null && candidates.length >= limit) break;
						try {
							if (!isQualifying({ event, location, from })) continue;
							const mapped = mapEventbriteEvent({ event });
							if (!mapped) continue;
							if (seen.has(mapped.sourceUrl)) continue;
							seen.add(mapped.sourceUrl);
							candidates.push({ event, mapped });
							kept++;
						} catch (error) {
							console.error(`Failed to process eventbrite event ${event?.id} (${event?.name}):`, error);
						}
					}
					console.error(`${location.name}: kept ${kept} of ${events.length} fetched events`);
				} catch (error) {
					failedLocations++;
					console.error(`Failed to fetch eventbrite events for ${location.name}:`, error);
				}
			},
		});

		if (!candidates.length && failedLocations === locations.length) {
			throw new Error(`Eventbrite search failed for every location`);
		}

		const selected = limit != null ? candidates.slice(0, limit) : candidates;
		await enrichDescriptions(selected);

		console.error(`--- Scraping finished. Total events collected: ${selected.length} ---`);
		return selected.map((candidate) => candidate.mapped);
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

export function mapEventbriteEvent({
	event,
	fullDescription,
}: {
	event: EbEvent;
	fullDescription?: string;
}): ScrapedEvent | undefined {
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
		description: getDescription({ event, fullDescription }),
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

function getName(event: EbEvent): string | undefined {
	if (typeof event?.name !== `string`) return undefined;
	const name = event.name.trim();
	return name || undefined;
}

function getStartAt(event: EbEvent): string | undefined {
	return toIso({ date: event?.start_date, time: event?.start_time, timeZone: event?.timezone });
}

function getEndAt(event: EbEvent): string | undefined {
	return toIso({ date: event?.end_date, time: event?.end_time, timeZone: event?.timezone });
}

function getTimezone(event: EbEvent): string | undefined {
	const timeZone = event?.timezone?.trim();
	return timeZone || undefined;
}

function getAddress(event: EbEvent): string[] {
	const address = event?.primary_venue?.address;
	const lines = address?.localized_multi_line_address_display?.map((line) => line.trim()).filter(Boolean);
	if (lines?.length) return lines;

	const parts: string[] = [];
	const venue = event?.primary_venue?.name?.trim();
	if (venue) parts.push(venue);
	const display = address?.localized_address_display?.trim();
	if (display) parts.push(display);
	return parts;
}

function getPrice(event: EbEvent): string | undefined {
	const tickets = event?.ticket_availability;
	if (!tickets) return undefined;
	if (tickets.is_free) return `Free`;

	const min = tickets.minimum_ticket_price?.display?.trim();
	const max = tickets.maximum_ticket_price?.display?.trim();
	if (min && max && min !== max) return `${min} – ${max}`;
	return min || max || undefined;
}

function getPriceIsHtml(event: EbEvent): boolean {
	void event;
	return false;
}

export function getDescription({
	event,
	fullDescription,
}: {
	event: EbEvent;
	fullDescription?: string;
}): string | undefined {
	const full = fullDescription?.trim();
	if (full) return cleanProseHtml(full) || undefined;

	if (typeof event?.summary !== `string`) return undefined;
	const summary = event.summary.trim();
	if (!summary) return undefined;
	const html = summary.includes(`<`) ? summary : `<p>${escapeHtml(summary)}</p>`;
	return cleanProseHtml(html) || undefined;
}

async function enrichDescriptions(candidates: DescriptionCandidate[]) {
	const withId = candidates.filter((candidate) => candidate.event.id);
	if (!withId.length) return;

	await mapPool({
		items: withId,
		concurrency: DESCRIPTION_CONCURRENCY,
		mapper: async (candidate) => {
			const eventId = candidate.event.id;
			if (!eventId) return;
			try {
				const fullDescription = await fetchFullDescription(eventId);
				const description = getDescription({ event: candidate.event, fullDescription });
				if (description) candidate.mapped.description = description;
			} catch (error) {
				console.error(`Failed to fetch eventbrite description for ${eventId}:`, error);
			}
		},
	});
}

async function fetchFullDescription(eventId: string): Promise<string | undefined> {
	const json = (await customFetch(DESCRIPTION_URL(eventId), {
		returnType: `json`,
		headers: { accept: `application/json` },
	})) as { description?: string };
	await sleep(REQUEST_DELAY_MS);

	if (typeof json?.description !== `string`) return undefined;
	const description = json.description.trim();
	return description || undefined;
}

async function mapPool<T>({
	items,
	concurrency,
	mapper,
}: {
	items: T[];
	concurrency: number;
	mapper: (item: T) => Promise<void>;
}) {
	if (!items.length) return;

	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			await mapper(items[index]);
		}
	});
	await Promise.all(workers);
}

function getImageUrls(event: EbEvent): string[] {
	const url = event?.image?.url?.trim();
	if (!url) return [];
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return [];
	return [url];
}

function getHost(event: EbEvent): string | undefined {
	const name = event?.primary_organizer?.name?.trim();
	return name || undefined;
}

function getHostLink(event: EbEvent): string | undefined {
	const url = event?.primary_organizer?.url?.trim();
	if (!url) return undefined;
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return undefined;
	return url;
}

function getContact(event: EbEvent): string[] {
	const website = event?.primary_organizer?.website_url?.trim();
	if (!website) return [];
	if (!website.startsWith(`http://`) && !website.startsWith(`https://`)) return [];
	return [website];
}

function getLatitude(event: EbEvent): number | undefined {
	return coordinate(event?.primary_venue?.address?.latitude);
}

function getLongitude(event: EbEvent): number | undefined {
	return coordinate(event?.primary_venue?.address?.longitude);
}

function getTags(event: EbEvent): string[] {
	const tags: string[] = [];
	for (const tag of event?.tags ?? []) {
		const name = tag?.display_name?.trim();
		if (!name || tags.includes(name)) continue;
		tags.push(name);
	}
	return tags;
}

function getSourceUrl(event: EbEvent): string | undefined {
	if (typeof event?.url !== `string`) return undefined;
	const url = event.url.trim();
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return undefined;
	return url;
}

function getSource(event: EbEvent): ScrapedEvent[`source`] {
	void event;
	return SOURCE;
}

function isQualifying({ event, location, from }: { event: EbEvent; location: EbLocation; from: string }): boolean {
	const name = getName(event);
	if (!name) return false;
	if (!matchesWhiteListWords(name)) return false;
	if (matchesBlackListWords(name)) return false;
	if (event.is_online_event) return false;
	if (event.is_cancelled) return false;
	if (!event.start_date || event.start_date < from) return false;

	const venue = event.primary_venue?.name?.trim().toLowerCase();
	if (venue && BLACKLISTED_VENUES.includes(venue)) return false;

	const latitude = getLatitude(event);
	const longitude = getLongitude(event);
	if (latitude == null || longitude == null) return false;

	const km = distanceKm({ lat1: location.lat, lon1: location.lon, lat2: latitude, lon2: longitude });
	return km <= RADIUS_KM;
}

async function fetchLocationEvents({
	session,
	location,
	from,
	to,
}: {
	session: SearchSession;
	location: EbLocation;
	from: string;
	to: string;
}): Promise<EbEvent[]> {
	const first = await searchEvents({ session, placeId: location.eventbritePlaceId, page: 1, from, to });
	if (!first.results?.length) {
		console.error(`${location.name}: no events in range`);
		return [];
	}

	if (first.objectCount <= FULL_SCAN_MAX) {
		const rest = await remainingPages({
			session,
			placeId: location.eventbritePlaceId,
			from,
			to,
			pageCount: first.pageCount,
		});
		console.error(`${location.name}: full scan of ${first.objectCount} events`);
		return [...first.results, ...rest];
	}

	console.error(`${location.name}: ${first.objectCount} events, searching conscious terms`);
	const events = [...first.results];
	for (const query of NARROW_QUERIES) {
		try {
			const page = await searchEvents({ session, placeId: location.eventbritePlaceId, page: 1, from, to, query });
			if (!page.results?.length) continue;
			if (page.objectCount >= first.objectCount || page.objectCount > NARROW_QUERY_MAX) {
				console.error(`  ${location.name} skip "${query}" (${page.objectCount} hits)`);
				continue;
			}
			events.push(...page.results);
			const rest = await remainingPages({
				session,
				placeId: location.eventbritePlaceId,
				from,
				to,
				pageCount: page.pageCount,
				query,
			});
			events.push(...rest);
			console.error(`  ${location.name} "${query}": ${page.objectCount} hits`);
		} catch (error) {
			console.error(`Failed Eventbrite query "${query}" for ${location.name}:`, error);
		}
	}
	return events;
}

async function remainingPages({
	session,
	placeId,
	from,
	to,
	pageCount,
	query,
}: {
	session: SearchSession;
	placeId: string;
	from: string;
	to: string;
	pageCount: number;
	query?: string;
}): Promise<EbEvent[]> {
	const events: EbEvent[] = [];
	const lastPage = Math.min(pageCount || 1, MAX_PAGES);
	for (let page = 2; page <= lastPage; page++) {
		const next = await searchEvents({ session, placeId, page, from, to, query });
		if (!next.results?.length) break;
		events.push(...next.results);
	}
	return events;
}

async function searchEvents({
	session,
	placeId,
	page,
	from,
	to,
	query,
}: {
	session: SearchSession;
	placeId: string;
	page: number;
	from: string;
	to: string;
	query?: string;
}): Promise<EbSearchPage> {
	try {
		return await postSearch({ session, placeId, page, from, to, query });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes(`401`) && !message.toLowerCase().includes(`csrf`)) throw error;
		console.error(`Refreshing Eventbrite csrftoken`);
		session.csrfToken = await getCsrfToken();
		return await postSearch({ session, placeId, page, from, to, query });
	}
}

async function postSearch({
	session,
	placeId,
	page,
	from,
	to,
	query,
}: {
	session: SearchSession;
	placeId: string;
	page: number;
	from: string;
	to: string;
	query?: string;
}): Promise<EbSearchPage> {
	const eventSearch: Record<string, unknown> = {
		places: [placeId],
		page,
		page_size: PAGE_SIZE,
		online_events_only: false,
		dedup: true,
		dates: [`current_future`],
		date_range: { from, to },
	};
	if (query) eventSearch.q = query;

	const json = (await customFetch(SEARCH_URL, {
		method: `POST`,
		returnType: `json`,
		headers: {
			accept: `application/json`,
			"content-type": `application/json`,
			cookie: `csrftoken=${session.csrfToken}`,
			"x-csrftoken": session.csrfToken,
			referer: `https://www.eventbrite.com/`,
			origin: `https://www.eventbrite.com`,
		},
		body: JSON.stringify({
			browse_surface: `search`,
			event_search: eventSearch,
			"expand.destination_event": [`primary_venue`, `image`, `ticket_availability`, `primary_organizer`],
		}),
	})) as EbSearchResponse;

	await sleep(REQUEST_DELAY_MS);

	const results = Array.isArray(json?.events?.results) ? json.events.results : [];
	return {
		objectCount: json?.events?.pagination?.object_count ?? results.length,
		pageCount: json?.events?.pagination?.page_count ?? 1,
		results,
	};
}

async function getCsrfToken(): Promise<string> {
	const res = await fetch(`https://www.eventbrite.com/`, {
		headers: {
			accept: `text/html`,
			"user-agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`,
		},
	});
	const cookies = res.headers.getSetCookie?.() ?? [];
	await res.body?.cancel();
	const csrf = cookies.map((cookie) => cookie.split(`;`)[0]).find((cookie) => cookie.startsWith(`csrftoken=`));
	const token = csrf?.slice(`csrftoken=`.length);
	if (!token) throw new Error(`Eventbrite did not set a csrftoken cookie`);
	return token;
}

function toIso({ date, time, timeZone }: { date?: string; time?: string; timeZone?: string }): string | undefined {
	if (!date) return undefined;
	const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!dateMatch) return undefined;

	const timeMatch = time?.match(/^(\d{2}):(\d{2})/);
	const hour = timeMatch ? timeMatch[1] : `00`;
	const minute = timeMatch ? timeMatch[2] : `00`;
	const year = Number(dateMatch[1]);
	const month = Number(dateMatch[2]);
	const day = Number(dateMatch[3]);
	const offset = offsetFor({ timeZone: timeZone?.trim() || `UTC`, year, month, day });
	return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${hour}:${minute}:00${offset}`;
}

function offsetFor({ timeZone, year, month, day }: { timeZone: string; year: number; month: number; day: number }): string {
	try {
		const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
		const part =
			new Intl.DateTimeFormat(`en`, { timeZone, timeZoneName: `longOffset` })
				.formatToParts(reference)
				.find((entry) => entry.type === `timeZoneName`)?.value ?? ``;
		const match = part.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
		if (!match) return `+00:00`;
		const hours = match[2].padStart(2, `0`);
		const minutes = (match[3] ?? `00`).padStart(2, `0`);
		return `${match[1]}${hours}:${minutes}`;
	} catch {
		return `+00:00`;
	}
}

function coordinate(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return undefined;
	return parsed;
}

function distanceKm({ lat1, lon1, lat2, lon2 }: { lat1: number; lon1: number; lat2: number; lon2: number }): number {
	const earthKm = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isoDay(offsetDays: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offsetDays);
	return date.toISOString().slice(0, 10);
}

function escapeHtml(text: string) {
	return text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`);
}

export function parseCliArgs(argv = process.argv.slice(2)): { query?: string; limit?: number } {
	const positional: string[] = [];
	let limit: number | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg === `-n`) {
			const raw = argv[++i];
			limit = parseLimitValue(raw);
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			limit = parseLimitValue(arg.slice(`--limit=`.length));
			continue;
		}
		if (arg.startsWith(`-`)) throw new Error(`Unknown option: ${arg}`);
		positional.push(arg);
	}

	const query = positional.join(` `).trim() || undefined;
	return { query, limit };
}

function parseLimitValue(raw: string | undefined): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit value: ${raw}`);
	return Math.floor(parsed);
}

if (import.meta.main) {
	try {
		const { query, limit } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite(query, limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error("Unhandled error in main execution:", error);
		process.exit(1);
	}
}

type EbLocation = ScrapeLocation & { eventbritePlaceId: string };

type DescriptionCandidate = {
	event: EbEvent;
	mapped: ScrapedEvent;
};

type SearchSession = {
	csrfToken: string;
};

type EbSearchPage = {
	objectCount: number;
	pageCount: number;
	results: EbEvent[];
};

type EbSearchResponse = {
	events?: {
		pagination?: {
			object_count?: number;
			page_count?: number;
		};
		results?: EbEvent[];
	};
};

type EbEvent = {
	id?: string;
	name?: string;
	url?: string;
	summary?: string;
	start_date?: string;
	start_time?: string;
	end_date?: string;
	end_time?: string;
	timezone?: string;
	is_online_event?: boolean;
	is_cancelled?: boolean | null;
	tags?: Array<{ display_name?: string }>;
	image?: { url?: string };
	primary_venue?: {
		name?: string;
		address?: {
			latitude?: string;
			longitude?: string;
			localized_address_display?: string;
			localized_multi_line_address_display?: string[];
		};
	};
	primary_organizer?: {
		name?: string;
		url?: string;
		website_url?: string;
	};
	ticket_availability?: {
		is_free?: boolean;
		minimum_ticket_price?: { display?: string };
		maximum_ticket_price?: { display?: string };
	};
};
