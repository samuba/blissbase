/**
 * Scrapes Facebook Events (https://www.facebook.com/events/).
 *
 * Facebook blocks unauthenticated listing/search HTML from datacenter IPs
 * (HTTP 400 "Sorry, something went wrong" / login walls). Discovery therefore
 * prefers documented Graph API page event feeds when credentials exist:
 *
 *   FACEBOOK_ACCESS_TOKEN  — Page or User token with pages_read_engagement
 *   FACEBOOK_PAGE_IDS      — comma-separated Page IDs (or usernames Graph accepts)
 *
 * Optional seed detail URLs (public event pages) via:
 *   FACEBOOK_EVENT_URLS=https://www.facebook.com/events/123,...
 *   or CLI: bun run scripts/scrape-facebook.ts https://www.facebook.com/events/123
 *
 * Detail HTML is fetched once and passed to getName(html) / getDescription(html) etc.
 * Local fixtures work via scrapeHtmlFiles / positional .html/.json paths.
 *
 * Usage:
 *   bun run scripts/scrape-facebook.ts
 *   bun run scripts/scrape-facebook.ts --limit 10
 *   bun run scripts/scrape-facebook.ts path/to/event.html
 *   bun run scripts/scrape-facebook.ts https://www.facebook.com/events/123
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	sleep,
	superTrim,
	REQUEST_DELAY_MS,
} from "./common.ts";

const SITE_BASE = `https://www.facebook.com`;
const EVENTS_LISTING_URL = `${SITE_BASE}/events/`;
const GRAPH_BASE = `https://graph.facebook.com/v21.0`;
const SOURCE = `facebook` as const;
const DETAIL_CONCURRENCY = 2;
const GRAPH_FIELDS = [
	`id`,
	`name`,
	`description`,
	`start_time`,
	`end_time`,
	`place`,
	`cover`,
	`owner`,
	`ticket_uri`,
	`is_online`,
	`event_times`,
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
			`Fetching Facebook events${resolvedLimit != null ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		const seen = new Set<string>();
		const events: ScrapedEvent[] = [];

		const push = (event: ScrapedEvent | undefined) => {
			if (!event) return;
			if (resolvedLimit != null && events.length >= resolvedLimit) return;
			if (seen.has(event.sourceUrl)) return;
			seen.add(event.sourceUrl);
			events.push(event);
		};

		const graphEvents = await fetchGraphPageEvents({ limit: resolvedLimit });
		for (const raw of graphEvents) {
			if (resolvedLimit != null && events.length >= resolvedLimit) break;
			try {
				const mapped = mapGraphEvent(raw);
				if (!mapped) continue;
				if (!passesNameFilter(mapped.name)) continue;
				push(mapped);
			} catch (error) {
				console.error(`Failed to process Graph event ${raw?.id}:`, error);
			}
		}

		const seedUrls = collectSeedUrls({ limit: resolvedLimit, already: events.length });
		if (seedUrls?.length) {
			console.error(`Fetching ${seedUrls.length} seeded event detail page(s)...`);
			const details = await mapPool({
				items: seedUrls,
				concurrency: DETAIL_CONCURRENCY,
				mapper: async (url) => {
					try {
						await sleep(REQUEST_DELAY_MS);
						const html = await customFetch(url, { returnType: `text`, maxRetries: 1 });
						if (isBlockedHtml(html)) {
							console.error(`Blocked/login wall for ${url}`);
							return undefined;
						}
						return await mapFacebookHtmlEvent({ html, url });
					} catch (error) {
						console.error(`Failed to fetch/parse ${url}:`, error);
						return undefined;
					}
				},
			});
			for (const event of details) {
				if (!event) continue;
				if (!passesNameFilter(event.name)) continue;
				push(event);
			}
		}

		if (!events.length && !graphEvents.length && !seedUrls.length) {
			await probeListingBlocked();
			console.error(
				`Facebook live discovery needs FACEBOOK_ACCESS_TOKEN + FACEBOOK_PAGE_IDS ` +
					`(Graph /{page-id}/events) and/or FACEBOOK_EVENT_URLS seed detail links. ` +
					`Unauthenticated listing HTML is blocked. Returning 0 events.`,
			);
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const raw = await Bun.file(filePath).text();
				if (looksLikeJson(raw)) {
					const items = parseGraphPayload(raw);
					for (const item of items) {
						try {
							const mapped = mapGraphEvent(item);
							if (mapped && passesNameFilter(mapped.name)) events.push(mapped);
						} catch (error) {
							console.error(`Failed to process Graph item from ${filePath}:`, error);
						}
					}
					continue;
				}
				const event = await mapFacebookHtmlEvent({ html: raw, url: filePath });
				if (event && passesNameFilter(event.name)) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapFacebookHtmlEvent({ html, url });
		} catch (error) {
			console.error(`Error extracting event data for ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName(html);
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt(html);
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt(html);
	}
	extractAddress(html: string): string[] | undefined {
		return getAddress(html);
	}
	extractPrice(html: string): string | undefined {
		return getPrice(html);
	}
	extractDescription(html: string): string | undefined {
		return getDescription(html);
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls(html);
	}
	extractHost(html: string): string | undefined {
		return getHost(html);
	}
	extractHostLink(html: string): string | undefined {
		return getHostLink(html);
	}
	extractTags(html: string): string[] | undefined {
		return getTags(html);
	}
}

export async function mapFacebookHtmlEvent(args: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const { html, url } = args;
	if (isBlockedHtml(html)) {
		console.error(`Skipping blocked Facebook HTML for ${url}`);
		return undefined;
	}

	const name = getName(html);
	const startAt = getStartAt(html);
	if (!name || !startAt) {
		console.error(`Skipping ${url} due to missing name or startAt.`);
		return undefined;
	}

	const sourceUrl = getSourceUrl(html) ?? canonicalizeEventUrl(url) ?? url;
	let endAt = getEndAt(html);
	if (endAt && endAt < startAt) endAt = undefined;

	const address = getAddress(html);
	let latitude = getLatitude(html);
	let longitude = getLongitude(html);
	let timezone: string | null = null;
	const apiKey = process.env.GOOGLE_MAPS_API_KEY || ``;

	if (latitude == null && longitude == null && address?.length && !isOnlineAddress(address)) {
		try {
			const { geocodeAddressCached } = await import(`../src/lib/server/google.script.ts`);
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey,
			});
			latitude = geocoded?.lat ?? null;
			longitude = geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? null;
		} catch (error) {
			console.error(`Geocoding failed for ${url}:`, error);
		}
	}

	if (timezone == null && latitude != null && longitude != null) {
		try {
			const { getTimezoneForCoordinatesCached } = await import(`../src/lib/server/google.script.ts`);
			timezone = await getTimezoneForCoordinatesCached({ lat: latitude, lng: longitude, apiKey });
		} catch (error) {
			console.error(`Timezone lookup failed for ${url}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt,
		timezone,
		address,
		price: getPrice(html) ?? null,
		priceIsHtml: false,
		description: getDescription(html) ?? null,
		imageUrls: getImageUrls(html) ?? [],
		host: getHost(html) ?? null,
		hostLink: getHostLink(html) ?? null,
		contact: getContact(html),
		latitude,
		longitude,
		tags: getTags(html) ?? [],
		sourceUrl,
		source: SOURCE,
	};
}

export function mapGraphEvent(event: GraphEvent | undefined): ScrapedEvent | undefined {
	if (!event) return undefined;
	const name = graphName(event);
	const startAt = graphStartAt(event);
	const sourceUrl = graphSourceUrl(event);
	if (!name || !startAt || !sourceUrl) return undefined;

	let endAt = graphEndAt(event);
	if (endAt && endAt < startAt) endAt = undefined;

	return {
		name,
		startAt,
		endAt,
		timezone: undefined,
		address: graphAddress(event),
		price: undefined,
		priceIsHtml: false,
		description: graphDescription(event),
		imageUrls: graphImageUrls(event),
		host: graphHost(event),
		hostLink: graphHostLink(event),
		contact: graphContact(event),
		latitude: graphLatitude(event),
		longitude: graphLongitude(event),
		tags: graphTags(event),
		sourceUrl,
		source: SOURCE,
	};
}

export function getName(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const embeddedName = textValue(embedded?.name) ?? textValue(embedded?.event_title);
	if (embeddedName) return embeddedName;

	const ld = readLdEvent(html);
	const ldName = textValue(ld?.name);
	if (ldName) return ldName;

	const og = metaContent(html, `og:title`);
	if (og) {
		const cleaned = og.replace(/\s*[|·•]\s*Facebook\s*$/i, ``).trim();
		if (cleaned) return cleaned;
	}

	const $ = cheerio.load(html);
	return superTrim($(`h1`).first().text()) || undefined;
}

export function getStartAt(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const fromTs = unixToIso(embedded?.start_timestamp ?? embedded?.start_time);
	if (fromTs) return fromTs;
	const fromIso = parseIsoDate(embedded?.start_time);
	if (fromIso) return fromIso;

	const ld = readLdEvent(html);
	const ldStart = parseIsoDate(ld?.startDate);
	if (ldStart) return ldStart;

	return parseIsoDate(metaContent(html, `event:start_time`));
}

export function getEndAt(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const fromTs = unixToIso(embedded?.end_timestamp ?? embedded?.end_time);
	if (fromTs) return fromTs;
	const fromIso = parseIsoDate(embedded?.end_time);
	if (fromIso) return fromIso;

	const ld = readLdEvent(html);
	const ldEnd = parseIsoDate(ld?.endDate);
	if (ldEnd) return ldEnd;

	return parseIsoDate(metaContent(html, `event:end_time`));
}

export function getAddress(html: string): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: unknown) => {
		const text = textValue(raw);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	const embedded = readEmbeddedEvent(html);
	const place = embedded?.event_place ?? embedded?.place;
	if (place && typeof place === `object`) {
		push(place.name);
		const city = place.city;
		if (city && typeof city === `object`) push(city.name);
		const address = place.address;
		if (typeof address === `string`) {
			for (const part of address.split(`,`)) push(part);
		} else if (address && typeof address === `object`) {
			push(address.street);
			push(address.city);
			push(address.country);
		}
		if (place.is_online || embedded?.is_online) push(`Online`);
	}

	if (embedded?.is_online && !lines.length) push(`Online`);

	const ld = readLdEvent(html);
	const location = ld?.location;
	if (location && typeof location === `object`) {
		push(location.name);
		const address = location.address;
		if (typeof address === `string`) {
			for (const part of address.split(`,`)) push(part);
		} else if (address && typeof address === `object`) {
			push(address.streetAddress);
			push(address.addressLocality);
			push(address.addressRegion);
			push(address.postalCode);
			push(address.addressCountry);
		}
	}

	const og = metaContent(html, `og:description`);
	if (!lines.length && og && /\bonline\b/i.test(og)) push(`Online`);

	return lines;
}

export function getPrice(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const ticket = textValue(embedded?.ticketing?.ticket_price) ?? textValue(embedded?.ticket_price);
	if (ticket) return ticket;

	const description = getDescription(html) ?? ``;
	const match = description.match(/(?:tickets?|price|harga)\s*[:\-–]?\s*([€$£Rp\d][\d.,\s€$£Rp]*?(?:free|gratis|donation|by donation)?)/i);
	if (match?.[1]) return superTrim(match[1]) || undefined;
	if (/\b(free|gratis|kostenlos)\b/i.test(description)) return `Free`;
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const embeddedText =
		textValue(embedded?.event_description?.text) ??
		textValue(embedded?.event_description) ??
		textValue(embedded?.description);
	if (embeddedText) {
		const asHtml = embeddedText.includes(`<`)
			? embeddedText
			: embeddedText
					.split(/\r?\n+/)
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => `<p>${escapeHtml(line)}</p>`)
					.join(``);
		return cleanProseHtml(asHtml) || undefined;
	}

	const ld = readLdEvent(html);
	const ldDesc = textValue(ld?.description);
	if (ldDesc) {
		const asHtml = ldDesc.includes(`<`)
			? ldDesc
			: ldDesc
					.split(/\r?\n+/)
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => `<p>${escapeHtml(line)}</p>`)
					.join(``);
		return cleanProseHtml(asHtml) || undefined;
	}

	const og = metaContent(html, `og:description`);
	if (!og) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(og)}</p>`) || undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const push = (raw: unknown) => {
		const url = textValue(raw);
		if (!url) return;
		if (!/^https?:\/\//i.test(url)) return;
		if (urls.includes(url)) return;
		urls.push(url);
	};

	const embedded = readEmbeddedEvent(html);
	push(embedded?.cover_photo?.photo?.image?.uri);
	push(embedded?.cover_photo?.photo?.url);
	push(embedded?.cover?.source);
	push(embedded?.image?.uri);

	const ld = readLdEvent(html);
	const image = ld?.image;
	if (typeof image === `string`) push(image);
	else if (Array.isArray(image)) for (const item of image) push(item);

	push(metaContent(html, `og:image`));
	return urls;
}

export function getHost(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const hosts = embedded?.event_hosts?.nodes ?? embedded?.event_hosts;
	if (Array.isArray(hosts) && hosts?.length) {
		const name = textValue(hosts[0]?.name);
		if (name) return name;
	}
	const owner = textValue(embedded?.owner?.name) ?? textValue(embedded?.event_creator?.name);
	if (owner) return owner;

	const ld = readLdEvent(html);
	const organizer = ld?.organizer;
	if (organizer && typeof organizer === `object`) return textValue(organizer.name);
	return undefined;
}

export function getHostLink(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const hosts = embedded?.event_hosts?.nodes ?? embedded?.event_hosts;
	if (Array.isArray(hosts) && hosts?.length) {
		const url = textValue(hosts[0]?.url) ?? textValue(hosts[0]?.profile_url);
		if (url) return absoluteFacebookUrl(url);
		const id = textValue(hosts[0]?.id);
		if (id) return `${SITE_BASE}/${id}`;
	}
	const ownerId = textValue(embedded?.owner?.id);
	if (ownerId) return `${SITE_BASE}/${ownerId}`;

	const ld = readLdEvent(html);
	const organizer = ld?.organizer;
	if (organizer && typeof organizer === `object`) {
		const url = textValue(organizer.url);
		if (url) return absoluteFacebookUrl(url);
	}
	return undefined;
}

export function getTags(html: string): string[] {
	const tags = new Set<string>();
	const embedded = readEmbeddedEvent(html);
	const categories = embedded?.event_category ?? embedded?.categories;
	if (typeof categories === `string`) tags.add(categories);
	else if (Array.isArray(categories)) {
		for (const item of categories) {
			const name = textValue(item?.name) ?? textValue(item);
			if (name) tags.add(name);
		}
	}
	if (embedded?.is_online || getAddress(html).some((line) => /online/i.test(line))) {
		tags.add(`Online`);
	}
	return [...tags];
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const push = (raw: unknown) => {
		const value = textValue(raw);
		if (!value) return;
		if (contacts.includes(value)) return;
		contacts.push(value);
	};

	const description = getDescription(html) ?? ``;
	const $ = cheerio.load(description);
	$(`a[href]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		if (!href) return;
		if (/^mailto:/i.test(href)) push(href.replace(/^mailto:/i, ``));
		else if (/wa\.me|whatsapp|t\.me|telegram|instagram\.com/i.test(href)) push(href);
	});

	const ticket = textValue(readEmbeddedEvent(html)?.ticketing?.uri) ?? textValue(readEmbeddedEvent(html)?.ticket_uri);
	push(ticket);
	return contacts;
}

export function getSourceUrl(html: string): string | undefined {
	const embedded = readEmbeddedEvent(html);
	const id = textValue(embedded?.id) ?? textValue(embedded?.eventId);
	if (id && /^\d+$/.test(id)) return `${SITE_BASE}/events/${id}/`;

	const og = metaContent(html, `og:url`);
	const fromOg = canonicalizeEventUrl(og);
	if (fromOg) return fromOg;

	const ld = readLdEvent(html);
	return canonicalizeEventUrl(textValue(ld?.url));
}

export function getLatitude(html: string): number | null {
	const embedded = readEmbeddedEvent(html);
	const lat =
		finiteNumber(embedded?.event_place?.location?.latitude) ??
		finiteNumber(embedded?.event_place?.coordinate?.latitude) ??
		finiteNumber(embedded?.place?.location?.latitude);
	if (lat != null) return lat;

	const ld = readLdEvent(html);
	const geo = ld?.location?.geo;
	return finiteNumber(geo?.latitude);
}

export function getLongitude(html: string): number | null {
	const embedded = readEmbeddedEvent(html);
	const lng =
		finiteNumber(embedded?.event_place?.location?.longitude) ??
		finiteNumber(embedded?.event_place?.coordinate?.longitude) ??
		finiteNumber(embedded?.place?.location?.longitude);
	if (lng != null) return lng;

	const ld = readLdEvent(html);
	const geo = ld?.location?.geo;
	return finiteNumber(geo?.longitude);
}

export function extractEventUrls(html: string): string[] {
	const urls = new Set<string>();
	const $ = cheerio.load(html);
	$(`a[href*="/events/"]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		const canonical = canonicalizeEventUrl(href);
		if (canonical) urls.add(canonical);
	});
	for (const match of html.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/events\/(\d{6,})/g)) {
		urls.add(`${SITE_BASE}/events/${match[1]}/`);
	}
	return [...urls];
}

export function isBlockedHtml(html: string): boolean {
	if (!html?.trim()) return true;
	if (html.length < 4000 && /Sorry, something went wrong/i.test(html)) return true;
	if (/login_form|name="email".*name="pass"|checkpoint\/block/i.test(html) && !/\/events\/\d+/i.test(html)) {
		return /og:title|application\/ld\+json|"__typename"\s*:\s*"Event"/i.test(html) === false;
	}
	return false;
}

export function parseCliArgs(argv = process.argv.slice(2)): {
	limit?: number;
	files: string[];
	urls: string[];
} {
	const files: string[] = [];
	const urls: string[] = [];
	let limit: number | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg === `-n`) {
			const raw = argv[++i];
			const parsed = Number(raw);
			if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --limit: ${raw}`);
			limit = parsed;
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			const raw = arg.slice(`--limit=`.length);
			const parsed = Number(raw);
			if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --limit: ${raw}`);
			limit = parsed;
			continue;
		}
		if (RUNNER_FLAGS.has(arg)) {
			if (arg === `--exclude` || arg === `--log-dir`) i++;
			continue;
		}
		if (arg.startsWith(`-`)) continue;
		if (/^https?:\/\//i.test(arg) || /facebook\.com\/events\//i.test(arg)) {
			const canonical = canonicalizeEventUrl(arg) ?? arg;
			urls.push(canonical);
			continue;
		}
		files.push(arg);
	}

	return { limit, files, urls };
}

export function parseGraphPayload(raw: string): GraphEvent[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	try {
		const data = JSON.parse(trimmed) as
			| GraphEvent
			| GraphEvent[]
			| { data?: GraphEvent[]; events?: { data?: GraphEvent[] } };
		if (Array.isArray(data)) return data;
		if (data && typeof data === `object`) {
			if (Array.isArray(data.data)) return data.data;
			if (Array.isArray(data.events?.data)) return data.events.data;
			if (`id` in data || `name` in data) return [data as GraphEvent];
		}
	} catch {
		return [];
	}
	return [];
}

export function canonicalizeEventUrl(raw: string | undefined | null): string | undefined {
	if (!raw?.trim()) return undefined;
	try {
		const url = new URL(raw.trim(), SITE_BASE);
		const match = url.pathname.match(/\/events\/(\d{6,})/);
		if (!match) return undefined;
		return `${SITE_BASE}/events/${match[1]}/`;
	} catch {
		return undefined;
	}
}

/** Drop access_token from Graph URLs so customFetch logs never print the secret. */
export function stripAccessToken(raw: string): string {
	try {
		const url = new URL(raw);
		url.searchParams.delete(`access_token`);
		return url.toString();
	} catch {
		return raw.replace(/([?&])access_token=[^&]*/g, `$1`).replace(/\?&/, `?`).replace(/[?&]$/, ``);
	}
}

async function fetchGraphPageEvents(args: { limit?: number }): Promise<GraphEvent[]> {
	const token = process.env.FACEBOOK_ACCESS_TOKEN?.trim();
	const pageIds = (process.env.FACEBOOK_PAGE_IDS ?? ``)
		.split(`,`)
		.map((id) => id.trim())
		.filter(Boolean);
	if (!token || !pageIds.length) {
		if (token && !pageIds.length) {
			console.error(`FACEBOOK_ACCESS_TOKEN set but FACEBOOK_PAGE_IDS is empty — skipping Graph discovery.`);
		}
		return [];
	}

	console.error(`Fetching Graph events for ${pageIds.length} page(s)...`);
	const events: GraphEvent[] = [];
	const seen = new Set<string>();

	const authHeaders = { Authorization: `Bearer ${token}` };

	for (const pageId of pageIds) {
		if (args.limit != null && events.length >= args.limit) break;
		try {
			let nextUrl: string | undefined =
				`${GRAPH_BASE}/${encodeURIComponent(pageId)}/events` +
				`?fields=${encodeURIComponent(GRAPH_FIELDS)}` +
				`&limit=50`;

			while (nextUrl) {
				if (args.limit != null && events.length >= args.limit) break;
				const payload = (await customFetch(stripAccessToken(nextUrl), {
					returnType: `json`,
					maxRetries: 2,
					headers: authHeaders,
				})) as GraphListResponse;
				if (payload?.error?.message) {
					console.error(`Graph error for page ${pageId}: ${payload.error.message}`);
					break;
				}
				for (const item of payload?.data ?? []) {
					if (!item?.id || seen.has(item.id)) continue;
					seen.add(item.id);
					events.push(item);
					if (args.limit != null && events.length >= args.limit) break;
				}
				nextUrl = payload?.paging?.next ? stripAccessToken(payload.paging.next) : undefined;
				if (nextUrl) await sleep(REQUEST_DELAY_MS);
			}
		} catch (error) {
			console.error(`Failed Graph fetch for page ${pageId}:`, error);
		}
	}

	console.error(`Graph returned ${events.length} event(s).`);
	return events;
}

function collectSeedUrls(args: { limit?: number; already: number }): string[] {
	const fromEnv = (process.env.FACEBOOK_EVENT_URLS ?? ``)
		.split(`,`)
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => canonicalizeEventUrl(value) ?? value);
	const fromCli = parseCliArgs().urls;
	const urls = [...new Set([...fromEnv, ...fromCli])];
	if (args.limit == null) return urls;
	const remaining = Math.max(0, args.limit - args.already);
	return urls.slice(0, remaining);
}

async function probeListingBlocked() {
	try {
		const response = await fetch(EVENTS_LISTING_URL, {
			headers: {
				"User-Agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`,
				Accept: `text/html`,
			},
			signal: AbortSignal.timeout(15_000),
		});
		const html = await response.text();
		if (!response.ok || isBlockedHtml(html)) {
			console.error(
				`Listing ${EVENTS_LISTING_URL} blocked without auth (HTTP ${response.status}).`,
			);
			return;
		}
		const urls = extractEventUrls(html);
		console.error(`Listing returned ${urls.length} event URL(s) without credentials.`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Listing probe failed for ${EVENTS_LISTING_URL}: ${message}`);
	}
}

function graphName(event: GraphEvent): string | undefined {
	return textValue(event.name);
}

function graphStartAt(event: GraphEvent): string | undefined {
	return parseIsoDate(event.start_time);
}

function graphEndAt(event: GraphEvent): string | undefined {
	return parseIsoDate(event.end_time);
}

function graphSourceUrl(event: GraphEvent): string | undefined {
	const id = textValue(event.id);
	if (!id) return undefined;
	return `${SITE_BASE}/events/${id}/`;
}

function graphAddress(event: GraphEvent): string[] {
	if (event.is_online) return [`Online`];
	const lines: string[] = [];
	const push = (raw: unknown) => {
		const text = textValue(raw);
		if (!text) return;
		if (lines.some((line) => line.toLowerCase() === text.toLowerCase())) return;
		lines.push(text);
	};
	const place = event.place;
	if (!place) return lines;
	push(place.name);
	const location = place.location;
	if (location) {
		push(location.street);
		push(location.city);
		push(location.state);
		push(location.zip);
		push(location.country);
	}
	return lines;
}

function graphDescription(event: GraphEvent): string | undefined {
	const raw = textValue(event.description);
	if (!raw) return undefined;
	const html = raw
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join(``);
	return cleanProseHtml(html) || undefined;
}

function graphImageUrls(event: GraphEvent): string[] {
	const source = textValue(event.cover?.source);
	return source ? [source] : [];
}

function graphHost(event: GraphEvent): string | undefined {
	return textValue(event.owner?.name);
}

function graphHostLink(event: GraphEvent): string | undefined {
	const id = textValue(event.owner?.id);
	return id ? `${SITE_BASE}/${id}` : undefined;
}

function graphContact(event: GraphEvent): string[] {
	const ticket = textValue(event.ticket_uri);
	return ticket ? [ticket] : [];
}

function graphLatitude(event: GraphEvent): number | null {
	return finiteNumber(event.place?.location?.latitude);
}

function graphLongitude(event: GraphEvent): number | null {
	return finiteNumber(event.place?.location?.longitude);
}

function graphTags(event: GraphEvent): string[] {
	return event.is_online ? [`Online`] : [];
}

function readEmbeddedEvent(html: string): EmbeddedEvent | undefined {
	if (!html) return undefined;

	const scriptChunks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? ``);
	const haystacks = scriptChunks?.length ? scriptChunks : [html];

	for (const chunk of haystacks) {
		if (!chunk.includes(`Event`) && !chunk.includes(`start_timestamp`)) continue;
		for (const candidate of extractJsonObjects(chunk)) {
			const event = findEmbeddedEvent(candidate);
			if (event) return event;
		}
	}
	return undefined;
}

function findEmbeddedEvent(value: unknown, depth = 0): EmbeddedEvent | undefined {
	if (depth > 8 || value == null) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findEmbeddedEvent(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value !== `object`) return undefined;
	const record = value as Record<string, unknown>;
	const typeName = record.__typename;
	const hasEventShape =
		typeName === `Event` ||
		(typeof record.name === `string` &&
			(record.start_timestamp != null || record.start_time != null) &&
			(record.event_place != null || record.place != null || record.event_description != null));
	if (hasEventShape) return record as EmbeddedEvent;

	for (const nested of Object.values(record)) {
		const found = findEmbeddedEvent(nested, depth + 1);
		if (found) return found;
	}
	return undefined;
}

function extractJsonObjects(chunk: string): unknown[] {
	const out: unknown[] = [];
	for (let i = 0; i < chunk.length; i++) {
		if (chunk[i] !== `{`) continue;
		const slice = sliceBalancedObject(chunk, i);
		if (!slice) continue;
		i += slice.length - 1;
		if (slice.length < 20 || slice.length > 200_000) continue;
		if (!/"__typename"\s*:\s*"Event"|start_timestamp|event_place/.test(slice)) continue;
		try {
			out.push(JSON.parse(repairJson(slice)));
		} catch {
			/* ignore incomplete slices */
		}
	}
	return out;
}

function sliceBalancedObject(source: string, start: number): string | undefined {
	if (source[start] !== `{`) return undefined;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === `\\`) {
				escaped = true;
				continue;
			}
			if (char === `"`) inString = false;
			continue;
		}
		if (char === `"`) {
			inString = true;
			continue;
		}
		if (char === `{`) depth++;
		else if (char === `}`) {
			depth--;
			if (depth === 0) return source.slice(start, i + 1);
		}
	}
	return undefined;
}

function repairJson(raw: string): string {
	return raw.replace(/,\s*([\]}])/g, `$1`);
}

function readLdEvent(html: string): LdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).html() || $(el).text();
		if (!text?.includes(`Event`)) continue;
		try {
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as unknown;
			const event = ldNodes(parsed).find((node) => {
				const type = node?.[`@type`];
				return type === `Event` || (Array.isArray(type) && type.includes(`Event`));
			});
			if (event) return event;
		} catch (error) {
			console.error(`Event JSON-LD is not valid JSON:`, error);
		}
	}
	return undefined;
}

function ldNodes(parsed: unknown): LdEvent[] {
	if (Array.isArray(parsed)) return parsed as LdEvent[];
	if (!parsed || typeof parsed !== `object`) return [];
	const graph = (parsed as Record<string, unknown>)[`@graph`];
	if (Array.isArray(graph)) return graph as LdEvent[];
	return [parsed as LdEvent];
}

function metaContent(html: string, property: string): string | undefined {
	const $ = cheerio.load(html);
	const content =
		$(`meta[property="${property}"]`).attr(`content`) ||
		$(`meta[name="${property}"]`).attr(`content`);
	return superTrim(content) || undefined;
}

function parseIsoDate(value: unknown): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const date = new Date(value.trim());
	if (Number.isNaN(date.getTime())) return undefined;
	return value.trim().includes(`T`) ? value.trim() : date.toISOString();
}

function unixToIso(value: unknown): string | undefined {
	const num = finiteNumber(value);
	if (num == null) return undefined;
	const ms = num > 1e12 ? num : num * 1000;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value === `string` && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function textValue(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	return superTrim(value) || undefined;
}

function absoluteFacebookUrl(raw: string): string {
	try {
		return new URL(raw, SITE_BASE).toString();
	} catch {
		return raw;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function looksLikeJson(raw: string): boolean {
	const trimmed = raw.trim();
	return trimmed.startsWith(`{`) || trimmed.startsWith(`[`);
}

function isOnlineAddress(address: string[]): boolean {
	return address.some((line) => /^online$/i.test(line.trim()));
}

function passesNameFilter(name: string): boolean {
	if (matchesBlackListWords(name)) return false;
	return matchesWhiteListWords(name);
}

async function mapPool<T, R>(args: {
	items: T[];
	concurrency: number;
	mapper: (item: T) => Promise<R>;
}): Promise<R[]> {
	const { items, concurrency, mapper } = args;
	if (!items?.length) return [];
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await mapper(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

if (import.meta.main) {
	try {
		const { limit, files, urls } = parseCliArgs();
		const scraper = new WebsiteScraper();
		if (files?.length) {
			const events = await scraper.scrapeHtmlFiles(files);
			console.log(events);
		} else if (urls?.length && !process.env.FACEBOOK_EVENT_URLS) {
			process.env.FACEBOOK_EVENT_URLS = urls.join(`,`);
			const events = await scraper.scrapeWebsite(limit);
			console.log(events);
		} else {
			const events = await scraper.scrapeWebsite(limit);
			console.log(events);
		}
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type GraphEvent = {
	id?: string;
	name?: string;
	description?: string;
	start_time?: string;
	end_time?: string;
	is_online?: boolean;
	ticket_uri?: string;
	cover?: { source?: string };
	owner?: { id?: string; name?: string };
	place?: {
		name?: string;
		location?: {
			street?: string;
			city?: string;
			state?: string;
			zip?: string;
			country?: string;
			latitude?: number;
			longitude?: number;
		};
	};
};

type GraphListResponse = {
	data?: GraphEvent[];
	paging?: { next?: string };
	error?: { message?: string };
};

type EmbeddedEvent = {
	__typename?: string;
	id?: string;
	eventId?: string;
	name?: string;
	event_title?: string;
	start_timestamp?: number | string;
	end_timestamp?: number | string;
	start_time?: string | number;
	end_time?: string | number;
	is_online?: boolean;
	description?: string;
	event_description?: { text?: string } | string;
	ticket_price?: string;
	ticket_uri?: string;
	ticketing?: { ticket_price?: string; uri?: string };
	event_category?: string | { name?: string }[];
	categories?: string[] | { name?: string }[];
	cover?: { source?: string };
	cover_photo?: { photo?: { image?: { uri?: string }; url?: string } };
	image?: { uri?: string };
	owner?: { id?: string; name?: string };
	event_creator?: { name?: string };
	event_hosts?: { nodes?: { id?: string; name?: string; url?: string; profile_url?: string }[] } | {
		id?: string;
		name?: string;
		url?: string;
		profile_url?: string;
	}[];
	event_place?: {
		name?: string;
		is_online?: boolean;
		city?: { name?: string };
		address?: string | { street?: string; city?: string; country?: string };
		location?: { latitude?: number; longitude?: number };
		coordinate?: { latitude?: number; longitude?: number };
	};
	place?: EmbeddedEvent[`event_place`];
};

type LdEvent = {
	[`@type`]?: string | string[];
	name?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	url?: string;
	image?: string | string[];
	organizer?: { name?: string; url?: string };
	location?: {
		name?: string;
		address?:
			| string
			| {
					streetAddress?: string;
					addressLocality?: string;
					addressRegion?: string;
					postalCode?: string;
					addressCountry?: string;
			  };
		geo?: { latitude?: number; longitude?: number };
	};
};
