/**
 * Scrapes todo.today via public HTTP APIs (listings, venue map, admin-ajax
 * details, ticket links). Defaults to ubud, canggu, koh-phangan, pai.
 *
 * Usage:
 *   bun run scripts/scrape-todotoday.ts
 *   TODOTODAY_LOCATIONS=ubud,canggu bun run scripts/scrape-todotoday.ts
 */
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	TimeZoneString,
} from './common.ts';
import { BrowserSession } from './browserSession.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';
import * as cheerio from 'cheerio';

const BASE_URL = `https://todo.today`;
const LISTING_API = `${BASE_URL}/api/todo-today/v1/events`;
const APP_EVENT_API = `${BASE_URL}/api/app/event`;
const APP_VENUES_API = `${BASE_URL}/api/app/events-venue`;
const ADMIN_AJAX = `${BASE_URL}/wp-admin/admin-ajax.php`;

const DEFAULT_LOCATIONS = [`ubud`, `canggu`, `koh-phangan`, `pai`] as const;
const LOCATIONS = process.env.TODOTODAY_LOCATIONS
	? process.env.TODOTODAY_LOCATIONS.split(`,`).map((location) => location.trim()).filter(Boolean)
	: [...DEFAULT_LOCATIONS];

/** Channel → IANA zone for local wall-clock times. Prefer this over the API when both exist
 * (Todo.Today's CMS has wrong zones for some channels, e.g. Lombok as Asia/Jakarta). */
const LOCATION_TIMEZONES: Record<string, TimeZoneString> = {
	ubud: `Asia/Makassar`,
	canggu: `Asia/Makassar`,
	uluwatu: `Asia/Makassar`,
	'kuta-lombok': `Asia/Makassar`, // WITA, not WIB — API incorrectly returns Asia/Jakarta
	'koh-phangan': `Asia/Bangkok`,
	pai: `Asia/Bangkok`,
	bangkok: `Asia/Bangkok`,
	'chiang-mai': `Asia/Bangkok`,
	'koh-tao': `Asia/Bangkok`,
	samui: `Asia/Bangkok`,
	phuket: `Asia/Bangkok`,
	'south-goa': `Asia/Kolkata`,
};

const KNOWN_TIME_ZONES = new Set<string>([
	`Asia/Ho_Chi_Minh`,
	`Asia/Makassar`,
	`Asia/Jakarta`,
	`Asia/Bangkok`,
	`Asia/Kolkata`,
	`Europe/Berlin`,
]);

/**
 * Requests are already spaced out by the session, so this only controls how much
 * parsing and geocoding overlaps the wait for the next slot.
 */
const DETAIL_CONCURRENCY = 3;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		let locationsWithEvents = 0;
		const session = new BrowserSession({
			acceptLanguage: `en-US,en;q=0.9,id;q=0.8`,
			minGapMs: 700,
			maxGapMs: 2000,
		});

		try {
			// Land on a real page first: the APIs are then called with the cookies and
			// referer a browser would already have.
			await session
				.visit({ url: `${BASE_URL}/${LOCATIONS[0]}/` })
				.catch((error: unknown) => console.error(`Landing page visit failed (continuing):`, error));

			console.error(`Fetching Todo.Today venue map...`);
			const venuesById = await fetchVenuesById(session);
			console.error(`Loaded ${Object.keys(venuesById).length} venues`);

			for (const location of LOCATIONS) {
				console.error(`Scraping events for ${location}...`);

				for (const day of [`today`, `tomorrow`] as const) {
					try {
						const listingEvents = await fetchListingEvents({ session, location, day });
						if (!listingEvents.length) {
							console.warn(`No ${day} events for ${location}`);
							continue;
						}

						locationsWithEvents += 1;
						console.error(`[${location}/${day}] ${listingEvents.length} listing events — enriching...`);

						const events = await mapWithConcurrency({
							items: listingEvents,
							concurrency: DETAIL_CONCURRENCY,
							mapper: async (listingEvent) => {
								try {
									return await this.extractEventFromListing({
										session,
										listingEvent,
										location,
										venuesById,
									});
								} catch (error) {
									console.error(`[${location}/${day}] Failed ${listingEvent.slug ?? listingEvent.id}`, error);
									return undefined;
								}
							},
						});

						const extracted = events.filter((event): event is ScrapedEvent => Boolean(event));
						allEvents.push(...extracted);
						console.error(`[${location}/${day}] Extracted ${extracted.length}/${listingEvents.length}`);
					} catch (error) {
						console.error(`Failed to scrape ${day} events for ${location}`, error);
						continue;
					}
				}
			}

			if (locationsWithEvents === 0) {
				throw new Error(`No events found! Failed to fetch API data for all locations.`);
			}

			console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
			return allEvents;
		} finally {
			await session.close();
		}
	}

	scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	extractEventData(html: string, url: string): Promise<ScrapedEvent> {
		throw new Error(`Method not implemented.` + html + url);
	}

	private async extractEventFromListing(args: {
		session: BrowserSession;
		listingEvent: TtListingEvent;
		location: string;
		venuesById: Record<string, TtVenue>;
	}): Promise<ScrapedEvent | undefined> {
		const { session, listingEvent, location, venuesById } = args;
		if (!listingEvent.name || !listingEvent.link) return undefined;

		const parsed = parseEventUrl(listingEvent.link);
		if (!parsed) return undefined;

		const [detailData, appEvent] = await Promise.all([
			fetchSingleEvent({ session, params: parsed }),
			listingEvent.id != null
				? fetchAppEvent({ session, eventId: listingEvent.id })
				: Promise.resolve(null),
		]);

		const timeZone = resolveTimeZone({
			location,
			apiTimezone: detailData?.location?.timezone,
		});

		const dateStr = detailData?.start_date || `${parsed.year}-${parsed.month}-${parsed.day}`;
		const startTime = detailData?.start_time ?? listingEvent.start_time ?? undefined;
		const endTime = detailData?.end_time ?? listingEvent.end_time ?? undefined;
		// Multi-day retreats often have no clock time — treat as all-day starting midnight.
		const startAt = buildIsoFromApiDate({
			dateStr,
			timeStr: startTime || `00:00:00`,
			timeZone,
		});
		if (!startAt) return undefined;

		const endAt = endTime || detailData?.end_date
			? buildEndIso({
				startDateStr: dateStr,
				endDateStr: detailData?.end_date || undefined,
				startTimeStr: startTime || `00:00:00`,
				endTimeStr: endTime || `23:59:00`,
				timeZone,
			})
			: undefined;

		const venueFromApp = appEvent?.venue_id ? venuesById[String(appEvent.venue_id)] : undefined;
		const venueName = detailData?.venue?.name?.trim()
			|| venueFromApp?.name?.trim()
			|| listingEvent.venue?.trim();
		const venueArea = detailData?.venue?.area?.trim()
			|| listingEvent.area?.trim();
		const googleMap = detailData?.venue?.google_map_link?.trim()
			|| venueFromApp?.google_map_link?.trim()
			|| listingEvent.google_map?.trim();

		const address = [venueName, formatLocationName(location)].filter(Boolean) as string[];
		const geocodeResult = (googleMap || venueName || venueArea)
			? await geocodeAddressCached({
				addressLines: [venueName, venueArea, formatLocationName(location)].filter(Boolean) as string[],
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			})
			: null;

		let coordinates: { lat: number; lng: number } | null | undefined;
		const venueLat = detailData?.venue?.lat ? Number.parseFloat(detailData.venue.lat) : undefined;
		const venueLng = detailData?.venue?.lng ? Number.parseFloat(detailData.venue.lng) : undefined;
		if (venueLat !== undefined && venueLng !== undefined && !Number.isNaN(venueLat) && !Number.isNaN(venueLng)) {
			coordinates = { lat: venueLat, lng: venueLng };
		} else if (googleMap || venueName || venueArea) {
			coordinates = geocodeResult;
		}

		const creatorName = detailData?.creator?.name || listingEvent.creator_name || appEvent?.facilitator;
		const host = creatorName && creatorName.toLowerCase() !== `todo.today`
			? creatorName
			: undefined;
		const hostLink = detailData?.creator?.url?.trim() || undefined;

		const contact = collectContacts({ appEvent, detailData });
		const description = cleanDescription(detailData?.description);
		const imageUrls = detailData?.images?.length
			? detailData.images
			: listingEvent.image
				? [listingEvent.image]
				: [];
		const tags = (detailData?.categories ?? [])
			.map((cat) => cat.name?.replace(/[^\w\s\-&]/g, ``).trim())
			.filter((tag): tag is string => Boolean(tag));

		return {
			name: detailData?.name || listingEvent.name,
			description,
			imageUrls,
			startAt,
			endAt,
			address,
			price: detailData?.price_label || listingEvent.price_label || undefined,
			priceIsHtml: false,
			host,
			hostLink,
			contact,
			latitude: coordinates?.lat,
			longitude: coordinates?.lng,
			// Keep the same zone used to build startAt/endAt — geocode TZ can disagree and skew edits.
			timezone: timeZone,
			tags,
			sourceUrl: listingEvent.link,
			source: `todotoday`,
		};
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

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		console.error(`Starting Todo.Today API scrape`);
		const events = await scraper.scrapeWebsite();
		console.error({ events });
		console.error(`Main execution finished, exiting with code 0`);
		process.exit(0);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

async function fetchListingEvents(args: {
	session: BrowserSession;
	location: string;
	day: `today` | `tomorrow`;
}): Promise<TtListingEvent[]> {
	const params = new URLSearchParams({
		channel: args.location,
		event_date: args.day,
	});
	const payload = await args.session.json<TtListingResponse>({
		url: `${LISTING_API}?${params.toString()}`,
		referer: `${BASE_URL}/${args.location}/`,
	});

	const sections = payload?.sections;
	if (!sections?.length) return [];

	const events: TtListingEvent[] = [];
	const seenIds = new Set<number | string>();
	for (const section of sections) {
		if (!section?.events?.length) continue;
		for (const event of section.events) {
			const key = event.id ?? event.link;
			if (key == null || seenIds.has(key) || !event.link) continue;
			seenIds.add(key);
			events.push(event);
		}
	}
	return events;
}

async function fetchSingleEvent(args: {
	session: BrowserSession;
	params: ParsedEventUrl;
}): Promise<TtSingleEventData | null> {
	const { params } = args;
	try {
		const body = new URLSearchParams({
			action: `tt_get_single_event`,
			location: params.location,
			year: params.year,
			month: params.month,
			day: params.day,
			slug: params.slug,
		});
		const json = await args.session.json<{ success?: boolean; data?: TtSingleEventData }>({
			url: ADMIN_AJAX,
			method: `POST`,
			contentType: `application/x-www-form-urlencoded; charset=UTF-8`,
			referer: `${BASE_URL}/${params.location}/${params.year}/${params.month}/${params.day}/${params.slug}/`,
			headers: { [`X-Requested-With`]: `XMLHttpRequest` },
			body: body.toString(),
		});

		if (!json?.success || !json.data) return null;
		return json.data;
	} catch (error) {
		console.warn(`[detail] tt_get_single_event failed for ${params.slug}`, error);
		return null;
	}
}

async function fetchAppEvent(args: {
	session: BrowserSession;
	eventId: number;
}): Promise<TtAppEvent | null> {
	try {
		const json = await args.session.json<{ success?: boolean; data?: TtAppEvent }>({
			url: APP_EVENT_API,
			method: `POST`,
			contentType: `application/json`,
			referer: `${BASE_URL}/`,
			body: JSON.stringify({ event_id: args.eventId }),
		});

		if (!json?.data) return null;
		return json.data;
	} catch (error) {
		console.warn(`[app-event] failed for ${args.eventId}`, error);
		return null;
	}
}

async function fetchVenuesById(session: BrowserSession): Promise<Record<string, TtVenue>> {
	try {
		const json = await session.json<{ data?: TtVenue[] }>({
			url: APP_VENUES_API,
			referer: `${BASE_URL}/`,
		});

		const byId: Record<string, TtVenue> = {};
		for (const venue of json?.data ?? []) {
			if (!venue?.term_id) continue;
			byId[String(venue.term_id)] = venue;
		}
		return byId;
	} catch (error) {
		console.warn(`[venues] failed to load venue map`, error);
		return {};
	}
}

function cleanDescription(html?: string): string | null {
	if (!html?.trim()) return null;
	const $ = cheerio.load(html);
	$(`.tt-hidden`).remove();
	return cleanProseHtml($.html()) || null;
}

function collectContacts(args: {
	appEvent: TtAppEvent | null;
	detailData: TtSingleEventData | null;
}): string[] {
	const candidates = [
		args.appEvent?.ticket_link,
		args.appEvent?.registration_link,
		args.appEvent?.external_link,
		args.appEvent?.facebook_link,
	];

	const contacts: string[] = [];
	const seen = new Set<string>();
	for (const raw of candidates) {
		const normalized = normalizeContactUrl(raw);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		contacts.push(normalized);
	}

	if (contacts.length) return contacts;

	// /go/ shortlinks 404 without a browser session — only keep non-todo.today book links
	const bookLink = normalizeContactUrl(args.detailData?.book_link);
	if (bookLink && !bookLink.includes(`todo.today`)) {
		return [bookLink];
	}
	return [];
}

function normalizeContactUrl(url?: string | null): string | undefined {
	if (!url?.trim()) return undefined;
	let normalized = url.trim();
	if (normalized.includes(`api.whatsapp.com`)) {
		const phoneNumber = normalized.match(/phone=(\d+)/)?.[1];
		if (phoneNumber) normalized = `https://wa.me/${phoneNumber}`;
	}
	return normalized;
}

function parseEventUrl(url: string): ParsedEventUrl | null {
	const match = url.match(/todo\.today\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^/?#]+)/);
	if (!match) return null;
	return {
		location: match[1],
		year: match[2],
		month: match[3],
		day: match[4],
		slug: match[5],
	};
}

function resolveTimeZone(args: {
	location: string;
	apiTimezone?: string;
}): TimeZoneString {
	const fromMap = LOCATION_TIMEZONES[args.location];
	if (fromMap) return fromMap;

	if (args.apiTimezone && KNOWN_TIME_ZONES.has(args.apiTimezone)) {
		return args.apiTimezone as TimeZoneString;
	}

	return `Asia/Makassar`;
}

function buildIsoFromApiDate(args: {
	dateStr?: string;
	timeStr?: string;
	timeZone: TimeZoneString;
}): string | undefined {
	if (!args.dateStr) return undefined;

	const [year, month, day] = args.dateStr.split(`-`).map(Number);
	if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;

	const parsedTime = parseTimeTo24h(args.timeStr);
	if (!parsedTime) return undefined;

	return dateToIsoStr(year, month, day, parsedTime.hour, parsedTime.minute, args.timeZone, false);
}

/** Builds end ISO; rolls overnight ends (end clock before start, no explicit end_date) to the next day. */
function buildEndIso(args: {
	startDateStr: string;
	endDateStr?: string;
	startTimeStr: string;
	endTimeStr: string;
	timeZone: TimeZoneString;
}): string | undefined {
	let endDateStr = args.endDateStr || args.startDateStr;

	if (!args.endDateStr) {
		const startTime = parseTimeTo24h(args.startTimeStr);
		const endTime = parseTimeTo24h(args.endTimeStr);
		if (startTime && endTime) {
			const startMinutes = startTime.hour * 60 + startTime.minute;
			const endMinutes = endTime.hour * 60 + endTime.minute;
			if (endMinutes <= startMinutes) {
				endDateStr = addDaysToDateStr(args.startDateStr, 1) ?? endDateStr;
			}
		}
	}

	return buildIsoFromApiDate({
		dateStr: endDateStr,
		timeStr: args.endTimeStr,
		timeZone: args.timeZone,
	});
}

function addDaysToDateStr(dateStr: string, days: number): string | undefined {
	const [year, month, day] = dateStr.split(`-`).map(Number);
	if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + days);
	const y = date.getUTCFullYear().toString().padStart(4, `0`);
	const m = (date.getUTCMonth() + 1).toString().padStart(2, `0`);
	const d = date.getUTCDate().toString().padStart(2, `0`);
	return `${y}-${m}-${d}`;
}

function parseTimeTo24h(timeStr?: string): { hour: number; minute: number } | undefined {
	if (!timeStr) return undefined;
	const trimmed = timeStr.trim();
	const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
	if (amPmMatch) {
		const rawHour = Number(amPmMatch[1]);
		const minute = Number(amPmMatch[2]);
		const period = amPmMatch[3].toUpperCase();
		if (isNaN(rawHour) || isNaN(minute)) return undefined;
		let hour = rawHour % 12;
		if (period === `PM`) hour += 12;
		return { hour, minute };
	}

	const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
	if (!twentyFourHourMatch) return undefined;
	const hour = Number(twentyFourHourMatch[1]);
	const minute = Number(twentyFourHourMatch[2]);
	if (isNaN(hour) || isNaN(minute)) return undefined;
	return { hour, minute };
}

function formatLocationName(location: string): string {
	return location
		.replace(/-/g, ` `)
		.split(` `)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(` `);
}

async function mapWithConcurrency<T, R>(args: {
	items: T[];
	concurrency: number;
	mapper: (item: T) => Promise<R>;
}): Promise<R[]> {
	const { items, concurrency, mapper } = args;
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

type ParsedEventUrl = {
	location: string;
	year: string;
	month: string;
	day: string;
	slug: string;
};

type TtListingEvent = {
	id?: number;
	name?: string;
	creator_name?: string;
	slug?: string;
	image?: string;
	link?: string;
	start_time?: string;
	end_time?: string;
	venue?: string;
	area?: string;
	google_map?: string;
	price_label?: string;
};

type TtListingResponse = {
	sections?: Array<{
		events?: TtListingEvent[];
	}>;
};

type TtSingleEventData = {
	name?: string;
	description?: string;
	start_date?: string;
	end_date?: string | null;
	start_time?: string;
	end_time?: string;
	images?: string[];
	price_label?: string;
	book_link?: string;
	venue?: {
		name?: string;
		area?: string;
		lat?: string;
		lng?: string;
		google_map_link?: string;
	};
	location?: {
		id?: number;
		name?: string;
		slug?: string;
		timezone?: string;
	};
	creator?: {
		name?: string;
		url?: string;
	};
	categories?: Array<{ name?: string }>;
};

type TtAppEvent = {
	event_id?: string;
	venue_id?: string;
	facilitator?: string;
	ticket_link?: string | null;
	registration_link?: string | null;
	external_link?: string | null;
	facebook_link?: string | null;
};

type TtVenue = {
	term_id?: string;
	name?: string;
	area?: string | null;
	google_map_link?: string;
	location_id?: string;
};
