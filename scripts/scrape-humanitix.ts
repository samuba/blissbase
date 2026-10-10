/**
 * Scrapes upcoming Humanitix events via the public discovery APIs the site uses:
 *   GET  https://humanitix.com/api/geocode?lat=&lng=
 *   POST https://humanitix.com/api/search
 *
 * Organizer REST at api.humanitix.com needs a private key and is not used.
 * Search cards omit descriptions; kept events are enriched from the event page
 * SvelteKit payload (`{slug}/__data.json` → `event.eventModules` richtext HTML).
 *
 * Places come from `scripts/locations.ts` (same set as Meetup/Eventbrite).
 * Discovery uses healthAndWellness + religionAndSpirituality + Blissbase theme
 * queries, then whitelist filter.
 *
 * Usage:
 *   bun run scripts/scrape-humanitix.ts
 *   bun run scripts/scrape-humanitix.ts Germany
 *   bun run scripts/scrape-humanitix.ts Berlin
 *   bun run scripts/scrape-humanitix.ts --limit 10
 *   bun run scripts/scrape-humanitix.ts Zürich --limit 5
 */
import type { ScrapedEvent } from "../src/lib/types.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	selectLocationsByQuery,
	sleep,
	REQUEST_DELAY_MS,
} from "./common.ts";
import { LOCATIONS, SEARCH_THEMES, type ScrapeLocation } from "./locations.ts";

const GEOCODE_URL = `https://humanitix.com/api/geocode`;
const SEARCH_URL = `https://humanitix.com/api/search`;
const SOURCE = `humanitix` as const;
const RADIUS_KM = 40;
const MAX_PAGES = 8;
const LOCATION_CONCURRENCY = 3;
const DETAIL_CONCURRENCY = 4;
const SEARCH_CATEGORIES = [`healthAndWellness`, `religionAndSpirituality`] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(query?: string, limit?: number): Promise<ScrapedEvent[]> {
		const locations = selectLocationsByQuery({ locations: LOCATIONS, query });
		if (!locations.length) throw new Error(`No Humanitix place matches "${query?.trim()}"`);
		console.error(
			`Fetching upcoming Humanitix events for ${locations.length} places${query ? ` matching "${query}"` : ``}${limit != null ? ` (limit ${limit})` : ``}...`,
		);

		const candidates: DetailCandidate[] = [];
		const seen = new Set<string>();
		let failedLocations = 0;

		await mapPool({
			items: locations,
			concurrency: LOCATION_CONCURRENCY,
			mapper: async (location) => {
				if (limit != null && candidates.length >= limit) return;
				try {
					const events = await fetchLocationEvents(location);
					let kept = 0;
					for (const event of events) {
						if (limit != null && candidates.length >= limit) break;
						try {
							if (!isQualifying(event)) continue;
							const mapped = mapHumanitixEvent({ event });
							if (!mapped) continue;
							if (seen.has(mapped.sourceUrl)) continue;
							seen.add(mapped.sourceUrl);
							candidates.push({ event, mapped });
							kept++;
						} catch (error) {
							console.error(`Failed to process humanitix event ${event?._id} (${event?.name}):`, error);
						}
					}
					console.error(`${location.name}: kept ${kept} of ${events.length} fetched events`);
				} catch (error) {
					failedLocations++;
					console.error(`Failed to fetch humanitix events for ${location.name}:`, error);
				}
			},
		});

		if (!candidates.length && failedLocations === locations.length) {
			throw new Error(`Humanitix search failed for every location`);
		}

		const selected = limit != null ? candidates.slice(0, limit) : candidates;
		await enrichDetails(selected);

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

export function mapHumanitixEvent({
	event,
	detail,
}: {
	event: HxEvent;
	detail?: HxEventDetail;
}): ScrapedEvent | undefined {
	const name = getName(event);
	const startAt = getStartAt({ event, detail });
	const sourceUrl = getSourceUrl(event);
	if (!name || !startAt || !sourceUrl) return undefined;

	return {
		name,
		startAt,
		endAt: getEndAt({ event, detail }),
		timezone: getTimezone(event),
		address: getAddress(event),
		price: getPrice(event),
		priceIsHtml: getPriceIsHtml(event),
		description: getDescription({ event, detail }),
		imageUrls: getImageUrls({ event, detail }),
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

function getName(event: HxEvent): string | undefined {
	if (typeof event?.name !== `string`) return undefined;
	const name = event.name.trim();
	return name || undefined;
}

function getStartAt({ event, detail }: { event: HxEvent; detail?: HxEventDetail }): string | undefined {
	const fromDetail = parseIsoInstant(detail?.startDate);
	if (fromDetail) return fromDetail;
	return parseHumanitixDate(event?.date?.startDate ?? event?.dates?.[0]?.startDate);
}

function getEndAt({ event, detail }: { event: HxEvent; detail?: HxEventDetail }): string | undefined {
	const fromDetail = parseIsoInstant(detail?.endDate);
	if (fromDetail) return fromDetail;
	return parseHumanitixDate(event?.date?.endDate ?? event?.dates?.[0]?.endDate);
}

function getTimezone(event: HxEvent): string | undefined {
	const timeZone = event?.timezone?.trim();
	return timeZone || undefined;
}

function getAddress(event: HxEvent): string[] {
	const location = event?.eventLocation;
	if (!location) return [];

	const lines: string[] = [];
	const venue = location.venueName?.trim();
	const address = location.address?.trim();
	if (venue) lines.push(venue);
	if (address && address !== venue) lines.push(address);
	return lines;
}

function getPrice(event: HxEvent): string | undefined {
	const pricing = event?.pricing;
	if (!pricing) return undefined;

	const min = pricing.minimumPrice;
	const max = pricing.maximumPrice;
	if (typeof min !== `number` || !Number.isFinite(min)) return undefined;
	if (min === 0 && (max == null || max === 0)) return `Free`;

	const currency = guessCurrency(event);
	const format = (amount: number) => {
		const raw = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
		return currency ? `${raw} ${currency}` : raw;
	};

	if (typeof max === `number` && Number.isFinite(max) && max !== min) {
		return `${format(min)} – ${format(max)}`;
	}
	return format(min);
}

function getPriceIsHtml(event: HxEvent): boolean {
	void event;
	return false;
}

export function getDescription({
	event,
	detail,
}: {
	event: HxEvent;
	detail?: HxEventDetail;
}): string | undefined {
	void event;
	const full = detail?.descriptionHtml?.trim();
	if (full) return cleanProseHtml(full) || undefined;

	const text = detail?.description?.trim();
	if (!text) return undefined;
	const html = text.includes(`<`) ? text : `<p>${escapeHtml(text)}</p>`;
	return cleanProseHtml(html) || undefined;
}

function getImageUrls({ event, detail }: { event: HxEvent; detail?: HxEventDetail }): string[] {
	const fromDetail = detail?.image?.trim();
	if (fromDetail && (fromDetail.startsWith(`http://`) || fromDetail.startsWith(`https://`))) {
		return [fromDetail.replace(/@seo-\d+\.jpg$/i, `@original`)];
	}

	const handle = event?.bannerImage?.handle?.trim();
	if (!handle) return [];
	return [`https://images.humanitix.com/i/${handle}@original`];
}

function getHost(event: HxEvent): string | undefined {
	const name = event?.organiser?.name?.trim();
	return name || undefined;
}

function getHostLink(event: HxEvent): string | undefined {
	void event;
	return undefined;
}

function getContact(event: HxEvent): string[] {
	void event;
	return [];
}

function getLatitude(event: HxEvent): number | undefined {
	void event;
	return undefined;
}

function getLongitude(event: HxEvent): number | undefined {
	void event;
	return undefined;
}

function getTags(event: HxEvent): string[] {
	void event;
	return [];
}

function getSourceUrl(event: HxEvent): string | undefined {
	const slug = event?.slug?.trim();
	if (!slug) return undefined;
	const host = event?.hostname?.trim() || `https://events.humanitix.com/`;
	const base = host.endsWith(`/`) ? host.slice(0, -1) : host;
	return `${base}/${slug}`;
}

function getSource(event: HxEvent): ScrapedEvent[`source`] {
	void event;
	return SOURCE;
}

function isQualifying(event: HxEvent): boolean {
	const name = getName(event);
	if (!name) return false;
	if (!matchesWhiteListWords(name)) return false;
	if (matchesBlackListWords(name)) return false;
	if (event?.eventLocation?.type === `online`) return false;
	if (!getStartAt({ event })) return false;
	return true;
}

async function fetchLocationEvents(location: ScrapeLocation): Promise<HxEvent[]> {
	const geocode = await resolveGeocode(location);
	if (!geocode) {
		console.error(`${location.name}: geocode failed`);
		return [];
	}

	const events: HxEvent[] = [];
	const seen = new Set<string>();

	const add = (batch: HxEvent[]) => {
		for (const event of batch) {
			const id = event?._id?.trim() || event?.slug?.trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			events.push(event);
		}
	};

	for (const category of SEARCH_CATEGORIES) {
		try {
			const before = events.length;
			add(await paginateSearch({ geocode, categories: [category] }));
			console.error(`${location.name}: ${category} → +${events.length - before} (${events.length} total)`);
		} catch (error) {
			console.error(`Failed Humanitix category "${category}" for ${location.name}:`, error);
		}
	}

	for (const theme of SEARCH_THEMES) {
		try {
			const page = await searchEvents({ geocode, query: theme, page: 0 });
			add(page);
		} catch (error) {
			console.error(`Failed Humanitix query "${theme}" for ${location.name}:`, error);
		}
	}

	return events;
}

async function paginateSearch({
	geocode,
	categories,
	query,
}: {
	geocode: HxGeocode;
	categories?: string[];
	query?: string;
}): Promise<HxEvent[]> {
	const events: HxEvent[] = [];
	const seen = new Set<string>();

	for (let page = 0; page < MAX_PAGES; page++) {
		const batch = await searchEvents({ geocode, categories, query, page });
		if (!batch.length) break;

		let fresh = 0;
		for (const event of batch) {
			const id = event?._id?.trim() || event?.slug?.trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			events.push(event);
			fresh++;
		}
		if (fresh === 0) break;
	}

	return events;
}

async function searchEvents({
	geocode,
	categories,
	query,
	page,
}: {
	geocode: HxGeocode;
	categories?: string[];
	query?: string;
	page: number;
}): Promise<HxEvent[]> {
	const body = {
		query: query ?? ``,
		locationQuery: ``,
		locationType: ``,
		types: [] as string[],
		categories: categories ?? [],
		subcategories: [] as string[],
		interests: [] as string[],
		prices: `all`,
		dates: ``,
		startDate: ``,
		endDate: ``,
		accessibility: [] as string[],
		page,
		safeSearch: true,
		stateKey: crypto.randomUUID(),
		geocode: {
			name: geocode.name,
			countryCode: geocode.countryCode,
			latLng: geocode.latLng,
			northeast: geocode.northeast,
			southwest: geocode.southwest,
			area: geocode.area,
		},
	};

	const json = (await customFetch(SEARCH_URL, {
		method: `POST`,
		returnType: `json`,
		headers: {
			accept: `application/json`,
			"content-type": `application/json`,
			origin: `https://humanitix.com`,
			referer: `https://humanitix.com/`,
		},
		body: JSON.stringify(body),
	})) as HxEvent[];

	await sleep(REQUEST_DELAY_MS);
	return Array.isArray(json) ? json : [];
}

async function resolveGeocode(location: ScrapeLocation): Promise<HxGeocode | undefined> {
	const url = `${GEOCODE_URL}?lat=${encodeURIComponent(String(location.lat))}&lng=${encodeURIComponent(String(location.lon))}`;
	const json = (await customFetch(url, {
		returnType: `json`,
		headers: { accept: `application/json` },
	})) as HxGeocodeResponse;
	await sleep(REQUEST_DELAY_MS);

	const data = json?.success ? json.data : undefined;
	const lat = typeof data?.lat === `number` ? data.lat : location.lat;
	const lng = typeof data?.lng === `number` ? data.lng : location.lon;
	const name = data?.name?.trim() || location.name;
	const countryCode =
		data?.countryCode?.trim().toLowerCase() ||
		data?.slug?.split(`--`)[0]?.toLowerCase() ||
		countryCodeFor(location.country);

	if (!countryCode) return undefined;

	const box = boundingBox({ lat, lng, radiusKm: RADIUS_KM });
	return {
		name,
		countryCode,
		latLng: { lat, lng },
		northeast: box.northeast,
		southwest: box.southwest,
		area: box.area,
	};
}

async function enrichDetails(candidates: DetailCandidate[]) {
	if (!candidates.length) return;

	await mapPool({
		items: candidates,
		concurrency: DETAIL_CONCURRENCY,
		mapper: async (candidate) => {
			try {
				const detail = await fetchEventDetail(candidate.mapped.sourceUrl);
				if (!detail) return;
				const description = getDescription({ event: candidate.event, detail });
				if (description) candidate.mapped.description = description;
				const startAt = getStartAt({ event: candidate.event, detail });
				if (startAt) candidate.mapped.startAt = startAt;
				const endAt = getEndAt({ event: candidate.event, detail });
				if (endAt) candidate.mapped.endAt = endAt;
				const images = getImageUrls({ event: candidate.event, detail });
				if (images.length) candidate.mapped.imageUrls = images;
			} catch (error) {
				console.error(`Failed to enrich humanitix event ${candidate.mapped.sourceUrl}:`, error);
			}
		},
	});
}

async function fetchEventDetail(sourceUrl: string): Promise<HxEventDetail | undefined> {
	const dataUrl = eventDataUrl(sourceUrl);
	if (!dataUrl) return undefined;

	const payload = (await customFetch(dataUrl, {
		returnType: `json`,
		headers: { accept: `application/json` },
	})) as HxDataPayload;
	await sleep(REQUEST_DELAY_MS);

	const event = readEventFromDataPayload(payload);
	if (!event) return undefined;

	const descriptionHtml = richtextDescription(event.eventModules);
	const seoDescription =
		typeof event.seo?.descriptions?.openGraph === `string`
			? event.seo.descriptions.openGraph
			: typeof event.seo?.descriptions?.default === `string`
				? event.seo.descriptions.default
				: undefined;
	const image =
		typeof event.seo?.image === `string`
			? event.seo.image
			: typeof event.images?.banner === `string`
				? event.images.banner
				: undefined;
	const startDate = firstOccurrenceIso(event.dates?.startDate ?? event.occurrences?.[0]?.startDate);
	const endDate = firstOccurrenceIso(event.dates?.endDate ?? event.occurrences?.[0]?.endDate);

	return {
		descriptionHtml,
		description: seoDescription,
		startDate,
		endDate,
		image,
	};
}

function eventDataUrl(sourceUrl: string): string | undefined {
	try {
		const url = new URL(sourceUrl);
		const path = url.pathname.replace(/\/+$/, ``);
		if (!path || path === `/`) return undefined;
		return `${url.origin}${path}/__data.json`;
	} catch {
		return undefined;
	}
}

function readEventFromDataPayload(payload: HxDataPayload): HxPageEvent | undefined {
	const nodes = payload?.nodes;
	if (!nodes?.length) return undefined;

	for (const node of nodes) {
		if (node?.type !== `data` || !node.data?.length) continue;
		const rootRefs = node.data[0];
		if (!rootRefs || typeof rootRefs !== `object` || Array.isArray(rootRefs)) continue;
		if (!(`event` in rootRefs)) continue;

		const resolved = resolveSvelteKitValue(node.data, 0);
		if (!resolved || typeof resolved !== `object` || Array.isArray(resolved)) continue;
		const event = (resolved as { event?: HxPageEvent }).event;
		if (event && typeof event === `object`) return event;
	}
	return undefined;
}

function richtextDescription(modules: HxEventModule[] | undefined): string | undefined {
	if (!modules?.length) return undefined;

	const richtexts = modules.filter(
		(module) => module?.component === `richtext` && typeof module.props?.content === `string` && module.props.content.trim(),
	);
	if (!richtexts.length) return undefined;

	const preferred = richtexts.find((module) => module.props?.title?.trim().toLowerCase() === `description`);
	const chosen = preferred ? [preferred] : richtexts;
	const html = chosen.map((module) => module.props?.content?.trim()).filter(Boolean).join(`\n`);
	return html || undefined;
}

function firstOccurrenceIso(value: unknown): string | undefined {
	if (typeof value === `string`) return parseIsoInstant(value) ?? parseHumanitixDate(value);
	return undefined;
}

/** Decode SvelteKit `devalue`-style numbered tables used by `/__data.json`. */
function resolveSvelteKitValue(table: unknown[], index: number, memo = new Map<number, unknown>()): unknown {
	if (memo.has(index)) return memo.get(index);
	if (index < 0 || index >= table.length) return undefined;

	const value = table[index];
	if (value === null || typeof value !== `object`) {
		memo.set(index, value);
		return value;
	}

	if (Array.isArray(value)) {
		const out: unknown[] = [];
		memo.set(index, out);
		for (const item of value) {
			out.push(typeof item === `number` ? resolveSvelteKitValue(table, item, memo) : item);
		}
		return out;
	}

	const out: Record<string, unknown> = {};
	memo.set(index, out);
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		out[key] = typeof item === `number` ? resolveSvelteKitValue(table, item, memo) : item;
	}
	return out;
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

function boundingBox({ lat, lng, radiusKm }: { lat: number; lng: number; radiusKm: number }) {
	const dLat = radiusKm / 111;
	const cos = Math.cos((lat * Math.PI) / 180);
	const dLng = radiusKm / (111 * Math.max(0.2, Math.abs(cos)));
	const northeast = { lat: lat + dLat, lng: lng + dLng };
	const southwest = { lat: lat - dLat, lng: lng - dLng };
	const heightKm = 2 * dLat * 111;
	const widthKm = 2 * dLng * 111 * Math.max(0.2, Math.abs(cos));
	return { northeast, southwest, area: heightKm * widthKm };
}

function parseHumanitixDate(value: string | null | undefined): string | undefined {
	if (typeof value !== `string`) return undefined;
	const raw = value.trim();
	if (!raw) return undefined;

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;
	if (date.getTime() < Date.now() - 3 * 60 * 60 * 1000) return undefined;
	return date.toISOString();
}

function parseIsoInstant(value: string | null | undefined): string | undefined {
	if (typeof value !== `string`) return undefined;
	const raw = value.trim();
	if (!raw) return undefined;
	if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) return undefined;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;
	if (date.getTime() < Date.now() - 3 * 60 * 60 * 1000) return undefined;
	return date.toISOString();
}

function guessCurrency(event: HxEvent): string | undefined {
	const country = event?.location?.trim().toUpperCase();
	if (country === `DE` || country === `AT`) return `EUR`;
	if (country === `CH`) return `CHF`;
	if (country === `GB`) return `GBP`;
	if (country === `AU`) return `AUD`;
	if (country === `NZ`) return `NZD`;
	if (country === `US`) return `USD`;
	return undefined;
}

function countryCodeFor(country: string): string | undefined {
	const map: Record<string, string> = {
		Germany: `de`,
		Austria: `at`,
		Switzerland: `ch`,
		Thailand: `th`,
		Vietnam: `vn`,
		Indonesia: `id`,
	};
	return map[country];
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
		const events = await new WebsiteScraper().scrapeWebsite(query, limit);
		console.log(JSON.stringify(events, null, 2));
		console.error(`Collected ${events.length} Humanitix events`);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type DetailCandidate = {
	event: HxEvent;
	mapped: ScrapedEvent;
};

type HxGeocode = {
	name: string;
	countryCode: string;
	latLng: { lat: number; lng: number };
	northeast: { lat: number; lng: number };
	southwest: { lat: number; lng: number };
	area: number;
};

type HxGeocodeResponse = {
	success?: boolean;
	data?: {
		slug?: string;
		name?: string;
		countryCode?: string;
		lat?: number;
		lng?: number;
	};
};

type HxEvent = {
	_id?: string;
	name?: string;
	slug?: string;
	hostname?: string;
	timezone?: string;
	location?: string;
	bannerImage?: { handle?: string };
	eventLocation?: {
		type?: string;
		address?: string;
		venueName?: string;
	};
	pricing?: {
		minimumPrice?: number;
		maximumPrice?: number;
	};
	date?: {
		startDate?: string;
		endDate?: string;
	};
	dates?: Array<{
		startDate?: string;
		endDate?: string;
	}>;
	organiser?: {
		_id?: string;
		name?: string;
	};
};

type HxEventDetail = {
	startDate?: string;
	endDate?: string;
	/** Full richtext HTML from event page modules. */
	descriptionHtml?: string;
	/** Short SEO / openGraph blurb fallback. */
	description?: string;
	image?: string;
};

type HxDataPayload = {
	nodes?: Array<{
		type?: string;
		data?: unknown[];
	}>;
};

type HxEventModule = {
	component?: string;
	props?: {
		title?: string;
		content?: string;
	};
};

type HxPageEvent = {
	dates?: { startDate?: string; endDate?: string };
	occurrences?: Array<{ startDate?: string; endDate?: string }>;
	eventModules?: HxEventModule[];
	seo?: {
		image?: string;
		descriptions?: {
			default?: string;
			openGraph?: string;
			twitter?: string;
		};
	};
	images?: {
		banner?: string;
	};
};
