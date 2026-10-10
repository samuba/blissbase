/**
 * Scrapes upcoming in-person Meetup events near the shared places in
 * `scripts/locations.ts` via Meetup's GraphQL API.
 *
 * Endpoint: POST https://api.meetup.com/gql-ext
 * Two searches per location (deduped by event id):
 *   1. recommendedEvents by catalog category (same as meetup.com/find)
 *   2. eventSearch by Blissbase theme keywords (Meetup search is AND-only)
 * Radius is miles. Whitelist still filters titles after fetch.
 *
 * Usage:
 *   bun run scripts/scrape-meetup.ts
 *   bun run scripts/scrape-meetup.ts Germany
 *   bun run scripts/scrape-meetup.ts Berlin
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import { WebsiteScraperInterface, cleanProseHtml, locationQueryFromArgs, markdownToHtml, selectLocationsByQuery } from "./common.ts";
import { LOCATIONS, type ScrapeLocation } from "./locations.ts";

const API_URL = `https://api.meetup.com/gql-ext`;
const SOURCE = `meetup` as const;
const PAGE_SIZE = 40;
const MAX_PAGES = 2;
const RADIUS_MILES = 50;
const LOOKAHEAD_DAYS = 90;
/** Parallel location searches. Keep modest — unauthenticated GraphQL is easy to throttle. */
const CONCURRENCY = 6;

/** Meetup find-page catalog categories (topicCategories IDs). */
const SEARCH_CATEGORIES = [
	{ id: `593`, name: `Religion & Spirituality` },
	{ id: `511`, name: `Health & Wellbeing` },
	{ id: `449`, name: `Support & Coaching` },
] as const;

const SEARCH_THEMES = [
	`meditation`,
	`breathwork`,
	`ecstatic dance`,
	`cacao`,
	`sound healing`,
	`tantra`,
	`kundalini`,
	`kirtan`,
	`intimacy`,
	`ceremony`,
	`inner-work`,
	`bodywork`,
	`relationship`,
	`energy-work`,
	`spirituality`,
	`shamanism`,
	`circle`,
];

const EVENT_FIELDS = `
        id
        title
        dateTime
        endTime
        eventType
        eventUrl
        description
        status
        featuredEventPhoto { highResUrl }
        venue { name address city state country lat lon }
        group { name urlname timezone }
        eventHosts { name member { name } }
        feeSettings { amount currency }
        topics { edges { node { name } } }
`;

const RECOMMENDED_EVENTS_QUERY = `
query recommendedEventsByCategory(
  $lat: Float!
  $lon: Float!
  $topicCategoryId: ID
  $startDateRange: String
  $endDateRange: String
  $first: Int
  $after: String
  $eventType: EventType
  $radius: Float
  $sortField: RecommendedEventsSortField
  $doConsolidateEvents: Boolean
) {
  result: recommendedEvents(
    filter: {
      lat: $lat
      lon: $lon
      topicCategoryId: $topicCategoryId
      startDateRange: $startDateRange
      endDateRange: $endDateRange
      eventType: $eventType
      radius: $radius
      doConsolidateEvents: $doConsolidateEvents
    }
    first: $first
    after: $after
    sort: { sortField: $sortField }
  ) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
${EVENT_FIELDS}
      }
    }
  }
}
`;

const EVENT_SEARCH_QUERY = `
query eventSearch($filter: EventSearchFilter!, $sort: KeywordSort, $first: Int, $after: String) {
  eventSearch(filter: $filter, sort: $sort, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
${EVENT_FIELDS}
      }
    }
  }
}
`;

const HIDDEN_STATUSES = new Set([
	`CANCELLED`,
	`CANCELLED_PERM`,
	`DRAFT`,
	`BLOCKED`,
	`PAST`,
	`TEMPLATE`,
	`PROPOSED`,
	`PENDING`,
	`AUTOSCHED_CANCELLED`,
	`AUTOSCHED_DRAFT`,
]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(query?: string): Promise<ScrapedEvent[]> {
		console.error(`Fetching upcoming Meetup events${query ? ` matching "${query}"` : ``}...`);
		const events = await fetchUpcomingEvents(query);
		console.error(`Found ${events.length} unique Meetup events. Mapping...`);
		const scraped = collectMeetupEvents(events);
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
export function collectMeetupEvents(events: MeetupEvent[]): ScrapedEvent[] {
	const scraped: ScrapedEvent[] = [];

	for (const event of events) {
		try {
			if (!isPublicEvent(event)) continue;
			if (!fitsBlissbase(event)) continue;
			const mapped = mapMeetupEvent(event);
			if (!mapped) {
				console.error(`Skipping Meetup event ${event?.id} due to missing name, start, or url.`);
				continue;
			}
			scraped.push(mapped);
		} catch (error) {
			console.error(`Failed to process Meetup event ${event?.id}:`, error);
		}
	}

	return scraped;
}

export function mapMeetupEvent(event: MeetupEvent): ScrapedEvent | undefined {
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

function getName(event: MeetupEvent): string | undefined {
	if (typeof event?.title !== `string`) return undefined;
	const name = event.title.trim();
	return name || undefined;
}

function getStartAt(event: MeetupEvent): string | undefined {
	const startAt = parseMeetupInstant(event?.dateTime);
	if (!startAt) return undefined;
	if (new Date(startAt).getTime() < Date.now() - 3 * 60 * 60 * 1000) return undefined;
	return startAt;
}

function getEndAt(event: MeetupEvent): string | undefined {
	const endAt = parseMeetupInstant(event?.endTime);
	if (!endAt) return undefined;
	const startAt = parseMeetupInstant(event?.dateTime);
	if (startAt && new Date(endAt).getTime() < new Date(startAt).getTime()) return undefined;
	return endAt;
}

/**
 * Meetup GraphQL DateTime is ISO-8601 with an offset (e.g. `2026-10-17T09:30:00+02:00`).
 * Reject naive local strings — `new Date("…T19:30:00")` would use the scraper machine's TZ.
 * Normalize to UTC so scrape-websites `new Date(startAt)` cannot reinterpret the wall clock.
 */
export function parseMeetupInstant(value: string | null | undefined): string | undefined {
	if (typeof value !== `string`) return undefined;
	const raw = value.trim();
	if (!raw) return undefined;

	// Rare input form used in Meetup filters: `…+01:00[Europe/Berlin]`
	const withoutBracket = raw.replace(/\[[^\]]+\]$/, ``);
	if (!hasExplicitUtcOffset(withoutBracket)) return undefined;

	const date = new Date(withoutBracket);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
}

function hasExplicitUtcOffset(iso: string): boolean {
	return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
}

function getTimezone(event: MeetupEvent): string | undefined {
	const zone = event?.group?.timezone?.trim();
	return zone || undefined;
}

function getAddress(event: MeetupEvent): string[] {
	const venue = event?.venue;
	if (!venue) return [];

	const lines: string[] = [];
	const name = venue.name?.trim();
	const address = venue.address?.trim();
	if (name) lines.push(name);
	if (address && address !== name) lines.push(address);

	const city = [venue.city?.trim(), venue.state?.trim()].filter(Boolean).join(`, `);
	if (city && !lines.some((line) => line.includes(city))) lines.push(city);

	const country = venue.country?.trim();
	if (country && country.length > 2 && !lines.some((line) => line.includes(country))) lines.push(country);
	return lines;
}

function getPrice(event: MeetupEvent): string | undefined {
	const amount = event?.feeSettings?.amount;
	if (typeof amount !== `number` || !Number.isFinite(amount) || amount < 0) return undefined;
	if (amount === 0) return `Free`;

	const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
	const currency = event.feeSettings?.currency?.trim();
	return currency ? `${formatted} ${currency}` : formatted;
}

function getPriceIsHtml(event: MeetupEvent): boolean {
	void event;
	return false;
}

function getDescription(event: MeetupEvent): string | undefined {
	if (typeof event?.description !== `string`) return undefined;
	const raw = event.description.trim();
	if (!raw) return undefined;
	return cleanProseHtml(markdownToHtml(raw)) || undefined;
}

function getImageUrls(event: MeetupEvent): string[] {
	const url = event?.featuredEventPhoto?.highResUrl?.trim();
	if (!url) return [];
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return [];
	return [url];
}

function getHost(event: MeetupEvent): string | undefined {
	const names = event?.eventHosts
		?.map((host) => host?.name?.trim() || host?.member?.name?.trim())
		.filter((name): name is string => Boolean(name));
	if (names?.length) return [...new Set(names)].join(`, `);

	const group = event?.group?.name?.trim();
	return group || undefined;
}

function getHostLink(event: MeetupEvent): string | undefined {
	const urlname = event?.group?.urlname?.trim();
	if (!urlname) return undefined;
	return `https://www.meetup.com/${urlname}/`;
}

function getContact(event: MeetupEvent): string[] {
	void event;
	return [];
}

function getLatitude(event: MeetupEvent): number | undefined {
	const lat = event?.venue?.lat;
	if (typeof lat !== `number` || !Number.isFinite(lat)) return undefined;
	return lat;
}

function getLongitude(event: MeetupEvent): number | undefined {
	const lon = event?.venue?.lon;
	if (typeof lon !== `number` || !Number.isFinite(lon)) return undefined;
	return lon;
}

function getTags(event: MeetupEvent): string[] {
	const names = event?.topics?.edges?.map((edge) => edge?.node?.name?.trim()).filter((name): name is string => Boolean(name));
	if (!names?.length) return [];
	return [...new Set(names)];
}

function getSourceUrl(event: MeetupEvent): string | undefined {
	if (typeof event?.eventUrl !== `string`) return undefined;
	const url = event.eventUrl.trim();
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return undefined;
	return url;
}

function getSource(event: MeetupEvent): ScrapedEvent[`source`] {
	void event;
	return SOURCE;
}

function fitsBlissbase(event: MeetupEvent): boolean {
	const name = getName(event);
	if (!name) return false;
	if (matchesBlackListWords(name)) return false;
	return matchesWhiteListWords(name);
}

function isPublicEvent(event: MeetupEvent): boolean {
	if (event?.eventType === `ONLINE`) return false;
	if (event?.status && HIDDEN_STATUSES.has(event.status)) return false;
	return true;
}

async function fetchUpcomingEvents(place?: string): Promise<MeetupEvent[]> {
	const events: MeetupEvent[] = [];
	const seenIds = new Set<string>();
	const { startDateRange, endDateRange } = upcomingRange();
	const locations = uniqueLocations(selectLocationsByQuery({ locations: LOCATIONS, query: place }));
	const tasks: SearchTask[] = [
		...locations.flatMap((location) => SEARCH_CATEGORIES.map((category) => ({ kind: `category` as const, category, location }))),
		...locations.flatMap((location) => SEARCH_THEMES.map((theme) => ({ kind: `theme` as const, theme, location }))),
	];
	let done = 0;
	let failures = 0;

	console.error(
		`Searching ${locations.length} locations × ${SEARCH_CATEGORIES.length} categories + ${SEARCH_THEMES.length} themes...`,
	);

	await mapPool({
		items: tasks,
		concurrency: CONCURRENCY,
		mapper: async (task) => {
			const label = task.kind === `category` ? task.category.name : task.theme;
			try {
				await paginateSearch({
					fetchPage: (after) =>
						task.kind === `category`
							? fetchCategoryPage({
									topicCategoryId: task.category.id,
									location: task.location,
									startDateRange,
									endDateRange,
									after,
								})
							: fetchThemePage({
									theme: task.theme,
									location: task.location,
									startDateRange,
									endDateRange,
									after,
								}),
					seenIds,
					events,
				});
			} catch (error) {
				failures += 1;
				console.error(`Failed Meetup search ${label} near ${task.location.name}:`, error);
			} finally {
				done += 1;
				if (done % 40 === 0 || done === tasks.length) {
					console.error(`Meetup progress ${done}/${tasks.length} — ${events.length} events so far`);
				}
			}
		},
	});

	if (tasks.length && failures === tasks.length) {
		throw new Error(`Meetup GraphQL search failed for every location`);
	}

	console.error(`Fetched ${events.length} unique Meetup events (${failures} searches failed)`);
	return events;
}

async function paginateSearch({
	fetchPage,
	seenIds,
	events,
}: {
	fetchPage: (after?: string) => Promise<MeetupEventConnection | undefined>;
	seenIds: Set<string>;
	events: MeetupEvent[];
}) {
	let after: string | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await fetchPage(after);
		const edges = result?.edges ?? [];
		if (!edges.length) return;

		for (const edge of edges) {
			const node = edge?.node;
			if (!node?.id || seenIds.has(node.id)) continue;
			seenIds.add(node.id);
			events.push(node);
		}

		if (edges.length < PAGE_SIZE) return;
		const cursor = result?.pageInfo?.endCursor;
		if (!result?.pageInfo?.hasNextPage || !cursor || cursor === after) return;
		after = cursor;
	}
}

async function fetchCategoryPage({
	topicCategoryId,
	location,
	startDateRange,
	endDateRange,
	after,
}: {
	topicCategoryId: string;
	location: ScrapeLocation;
	startDateRange: string;
	endDateRange: string;
	after?: string;
}): Promise<MeetupEventConnection | undefined> {
	const variables: Record<string, unknown> = {
		lat: location.lat,
		lon: location.lon,
		topicCategoryId,
		radius: RADIUS_MILES,
		eventType: `PHYSICAL`,
		startDateRange,
		endDateRange,
		doConsolidateEvents: true,
		first: PAGE_SIZE,
		sortField: `RELEVANCE`,
	};
	if (after) variables.after = after;

	const body = await postGraphql({
		payload: {
			operationName: `recommendedEventsByCategory`,
			query: RECOMMENDED_EVENTS_QUERY,
			variables,
		},
	});

	return body.data?.result ?? undefined;
}

async function fetchThemePage({
	theme,
	location,
	startDateRange,
	endDateRange,
	after,
}: {
	theme: string;
	location: ScrapeLocation;
	startDateRange: string;
	endDateRange: string;
	after?: string;
}): Promise<MeetupEventConnection | undefined> {
	const variables: {
		filter: Record<string, unknown>;
		sort: { sortField: string };
		first: number;
		after?: string;
	} = {
		first: PAGE_SIZE,
		sort: { sortField: `DATETIME` },
		filter: {
			query: theme,
			lat: location.lat,
			lon: location.lon,
			radius: RADIUS_MILES,
			eventType: `PHYSICAL`,
			startDateRange,
			endDateRange,
			doConsolidateEvents: true,
		},
	};
	if (after) variables.after = after;

	const body = await postGraphql({
		payload: {
			operationName: `eventSearch`,
			query: EVENT_SEARCH_QUERY,
			variables,
		},
	});

	return body.data?.eventSearch ?? undefined;
}

async function postGraphql({ payload }: { payload: unknown }): Promise<MeetupGraphqlResponse> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) {
			// Jitter so concurrent workers don't retry in lockstep after 429/5xx.
			const base = 1000 * 2 ** (attempt - 1);
			await Bun.sleep(base + Math.floor(Math.random() * 500));
		}

		let response: Response;
		try {
			response = await fetch(API_URL, {
				method: `POST`,
				headers: {
					[`content-type`]: `application/json`,
					accept: `application/json`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(20_000),
			});
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			continue;
		}

		if (response.status === 429 || response.status >= 500) {
			lastError = new Error(`Meetup GraphQL HTTP ${response.status}`);
			continue;
		}
		if (!response.ok) {
			throw new Error(`Meetup GraphQL HTTP ${response.status} ${await response.text()}`);
		}

		const body = (await response.json()) as MeetupGraphqlResponse;
		const message = body.errors
			?.map((error) => error.message)
			.filter(Boolean)
			.join(`; `);
		const hasData = body.data?.result != null || body.data?.eventSearch != null;
		if (message && !hasData) {
			lastError = new Error(message);
			if (/rate|throttl/i.test(message)) continue;
			throw lastError;
		}
		return body;
	}

	throw lastError ?? new Error(`Meetup GraphQL failed`);
}

async function mapPool<T>({ items, concurrency, mapper }: { items: T[]; concurrency: number; mapper: (item: T) => Promise<void> }) {
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

function uniqueLocations(locations: readonly ScrapeLocation[]): ScrapeLocation[] {
	const seen = new Set<string>();
	const unique: ScrapeLocation[] = [];

	for (const location of locations) {
		if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) continue;
		const key = `${location.lat.toFixed(4)},${location.lon.toFixed(4)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(location);
	}

	return unique;
}

function upcomingRange() {
	const start = new Date();
	const end = new Date(start.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
	return {
		startDateRange: meetupDateTime(start),
		endDateRange: meetupDateTime(end),
	};
}

function meetupDateTime(date: Date) {
	return date.toISOString().replace(/\.\d{3}Z$/, `Z`);
}

if (import.meta.main) {
	try {
		const events = await new WebsiteScraper().scrapeWebsite(locationQueryFromArgs());
		console.log(`Collected ${events.length} Meetup events`);
		for (const event of events) {
			console.log(`${event.startAt} | ${event.name} | ${event.sourceUrl}`);
			console.log(JSON.stringify(event, null, 2));
		}
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type MeetupEvent = {
	id?: string;
	title?: string | null;
	dateTime?: string | null;
	endTime?: string | null;
	eventType?: string | null;
	eventUrl?: string | null;
	description?: string | null;
	status?: string | null;
	featuredEventPhoto?: { highResUrl?: string | null } | null;
	venue?: {
		name?: string | null;
		address?: string | null;
		city?: string | null;
		state?: string | null;
		country?: string | null;
		lat?: number | null;
		lon?: number | null;
	} | null;
	group?: {
		name?: string | null;
		urlname?: string | null;
		timezone?: string | null;
	} | null;
	eventHosts?: { name?: string | null; member?: { name?: string | null } | null }[] | null;
	feeSettings?: { amount?: number | null; currency?: string | null } | null;
	topics?: { edges?: { node?: { name?: string | null } | null }[] | null } | null;
};

type MeetupEventConnection = {
	pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
	edges?: { node?: MeetupEvent | null }[] | null;
};

type MeetupGraphqlResponse = {
	data?: {
		result?: MeetupEventConnection | null;
		eventSearch?: MeetupEventConnection | null;
	} | null;
	errors?: { message?: string }[];
};

type SearchTask =
	| { kind: `category`; category: (typeof SEARCH_CATEGORIES)[number]; location: ScrapeLocation }
	| { kind: `theme`; theme: string; location: ScrapeLocation };
