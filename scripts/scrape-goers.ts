/**
 * Scrapes GOERS Bali events via their public GraphQL API at
 * graph.goersapp.com/v2 (`exploreContents` + `experienceContents`).
 *
 * Needs a headed Chromium (Playwright `channel: "chrome"`). Under SSH wrap with
 * xvfb-run; CI does that in scrape-source.yml. Headless (incl. channel-chrome
 * headless) is Queue-it / Cloudflare blocked.
 *
 * Usage:
 *   bun run scripts/scrape-goers.ts
 *   xvfb-run -a bun run scripts/scrape-goers.ts
 */
import { createHash } from "crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { ScrapedEvent } from "../src/lib/types.ts";
import { WebsiteScraperInterface, cleanProseHtml, sleep } from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";

const SITE_BASE = `https://www.goersapp.com`;
const API_URL = `https://graph.goersapp.com/v2`;
const API_SALT = `ZjMEHfLgaUiC5qmKq8`;
const APP_VERSION = `4.26.2`;
const APP_CHANNEL = `2`;
const SOURCE = `goers` as const;
const TIMEZONE = `Asia/Makassar`;
const FILTER_REGION = `Bali`;
const PAGE_LIMIT = 16;
const DETAIL_GAP_MS = 400;

const EXPLORE_URL = `${SITE_BASE}/explore?type=events&filter=location:region,${FILTER_REGION}`;

const CONTENTS_FRAGMENTS = `fragment contentFields on Content {
  type
  data
  layout
  analytic
  meta
  version
  __typename
}

fragment contentsFields on Contents {
  analytic
  meta
  contents {
    ...contentFields
    __typename
  }
  filters
  navigations
  __typename
}
`;

const EXPLORE_QUERY = `${CONTENTS_FRAGMENTS}
query exploreContents($input: ExploreContentsInput!) {
  exploreContents(input: $input) {
    ...contentsFields
    __typename
  }
}
`;

const EXPERIENCE_QUERY = `${CONTENTS_FRAGMENTS}
query experienceContents($input: ExperienceContentsInput!) {
  experienceContents(input: $input) {
    ...contentsFields
    __typename
  }
}
`;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const browser = await launchChrome();
		try {
			const page = await openGuestPage(browser);
			console.error(`Warming GOERS guest session on Bali explore…`);
			await warmExploreSession(page);

			console.error(`Fetching GOERS exploreContents (region=${FILTER_REGION})…`);
			const cards = await fetchAllExploreCards(page);
			console.error(`  cards: ${cards.length}`);

			const events: ScrapedEvent[] = [];
			const seen = new Set<string>();

			for (const card of cards) {
				try {
					const name = getName(card);
					if (!name) continue;
					if (matchesBlackListWords(name) || !matchesWhiteListWords(name)) continue;

					await sleep(DETAIL_GAP_MS);
					const shortUrl = getShortUrl(card);
					const sourceUrl = getSourceUrl(card);
					if (!shortUrl || !sourceUrl) {
						console.error(`Skipping card without shortUrl/sourceUrl: ${name}`);
						continue;
					}

					const detail = await gql<ExperiencePayload>({
						page,
						operationName: `experienceContents`,
						variables: { input: { shortUrl } },
						query: EXPERIENCE_QUERY,
						origin: sourceUrl,
					});
					const payload = detail?.experienceContents;
					if (!payload) {
						console.error(`No experienceContents for ${shortUrl}`);
						continue;
					}

					const event = mapGoersEvent({ card, payload, sourceUrl });
					if (!event) continue;
					if (seen.has(event.sourceUrl)) continue;
					seen.add(event.sourceUrl);
					events.push(event);
				} catch (error) {
					console.error(`Failed to process GOERS card:`, error);
				}
			}

			console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
			return events;
		} finally {
			await browser.close();
		}
	}

	async scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		throw new Error(`Method not implemented.` + html + url);
	}

	extractName(html: string): string | undefined {
		return getName(parseCardJson(html));
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt(parsePayloadJson(html));
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt(parsePayloadJson(html));
	}
	extractAddress(html: string): string[] | undefined {
		return getAddress(parsePayloadJson(html));
	}
	extractPrice(html: string): string | undefined {
		return getPrice(parseCardJson(html)) ?? getPriceFromPayload(parsePayloadJson(html));
	}
	extractDescription(html: string): string | undefined {
		return getDescription(parsePayloadJson(html));
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls(parsePayloadJson(html), parseCardJson(html));
	}
	extractHost(html: string): string | undefined {
		return getHost(parseCardJson(html)) ?? getHostFromPayload(parsePayloadJson(html));
	}
	extractHostLink(html: string): string | undefined {
		return getHostLink(parsePayloadJson(html));
	}
	extractTags(html: string): string[] | undefined {
		return getTags(parsePayloadJson(html));
	}
}

function mapGoersEvent(args: {
	card: ContentCard;
	payload: ExperiencePayloadContents;
	sourceUrl: string;
}): ScrapedEvent | undefined {
	const { card, payload, sourceUrl } = args;
	const name = getName(card) ?? getNameFromPayload(payload);
	const startAt = getStartAt(payload);
	if (!name || !startAt) return undefined;

	return {
		name,
		startAt,
		endAt: getEndAt(payload),
		timezone: TIMEZONE,
		address: getAddress(payload) ?? fallbackAddress(card),
		price: getPrice(card) ?? getPriceFromPayload(payload),
		priceIsHtml: false,
		description: getDescription(payload),
		imageUrls: getImageUrls(payload, card),
		host: getHost(card) ?? getHostFromPayload(payload),
		hostLink: getHostLink(payload),
		contact: [],
		latitude: getLatitude(payload),
		longitude: getLongitude(payload),
		tags: getTags(payload),
		sourceUrl,
		source: SOURCE,
	};
}

function getName(card: ContentCard | undefined): string | undefined {
	const name = card?.data?.name?.trim();
	return name || undefined;
}

function getNameFromPayload(payload: ExperiencePayloadContents): string | undefined {
	const title = payload.meta?.title?.trim();
	if (title) return title;
	const schema = eventSchema(payload);
	return schema?.name?.trim() || undefined;
}

function getStartAt(payload: ExperiencePayloadContents): string | undefined {
	const schema = eventSchema(payload);
	if (schema?.startDate) return schema.startDate;
	const schedule = findContent(payload, (c) => typeof c.meta?.start_date === `string`);
	const raw = schedule?.meta?.start_date;
	if (typeof raw !== `string` || !raw) return undefined;
	return localDateTimeToIso({ local: raw, offset: `+08:00` });
}

function getEndAt(payload: ExperiencePayloadContents): string | undefined {
	const schema = eventSchema(payload);
	if (schema?.endDate) return schema.endDate;
	const schedule = findContent(payload, (c) => typeof c.meta?.end_date === `string`);
	const raw = schedule?.meta?.end_date;
	if (typeof raw !== `string` || !raw) return undefined;
	return localDateTimeToIso({ local: raw, offset: `+08:00` });
}

function getAddress(payload: ExperiencePayloadContents): string[] | undefined {
	const schema = eventSchema(payload);
	const place = firstPlace(schema?.location);
	const lines: string[] = [];
	if (place?.name) lines.push(place.name);
	const addr = place?.address;
	if (addr?.streetAddress) lines.push(addr.streetAddress);
	const cityBits = [addr?.addressLocality, addr?.addressRegion].filter(Boolean);
	if (cityBits.length) lines.push(cityBits.join(`, `));
	if (addr?.addressCountry) lines.push(addr.addressCountry);

	if (!lines.length) {
		const loc = findContent(payload, (c) => typeof c.meta?.name === `string` && c.meta?.lat != null);
		if (loc?.meta?.name) lines.push(String(loc.meta.name));
		if (typeof loc?.meta?.address === `string` && loc.meta.address) lines.push(loc.meta.address);
	}
	return lines.length ? lines : undefined;
}

function fallbackAddress(card: ContentCard): string[] {
	const location = card.data?.location?.trim();
	return location ? [location] : [`Bali`, `Indonesia`];
}

function getPrice(card: ContentCard | undefined): string | undefined {
	const price = card?.data?.price?.trim();
	if (!price) return undefined;
	if (/^free$/i.test(price)) return `Free`;
	const caption = card.data?.price_caption?.trim();
	return caption ? `${caption} ${price}` : price;
}

function getPriceFromPayload(payload: ExperiencePayloadContents): string | undefined {
	const schema = eventSchema(payload);
	const range = schema?.priceRange?.trim();
	return range || undefined;
}

function getDescription(payload: ExperiencePayloadContents): string | undefined {
	const html = payload.meta?.description;
	if (!html?.trim()) return undefined;
	const cleaned = cleanProseHtml(html)?.trim();
	return cleaned || undefined;
}

function getImageUrls(payload: ExperiencePayloadContents, card?: ContentCard): string[] {
	const urls: string[] = [];
	const push = (url: unknown) => {
		if (typeof url !== `string` || !url.trim()) return;
		const clean = url.split(`?`)[0]!;
		if (!urls.includes(clean)) urls.push(clean);
	};
	for (const g of payload.meta?.galleries ?? []) push(g);
	push(payload.meta?.image);
	const schema = eventSchema(payload);
	if (Array.isArray(schema?.image)) for (const img of schema.image) push(img);
	else push(schema?.image);
	push(card?.data?.image);
	return urls;
}

function getHost(card: ContentCard | undefined): string | undefined {
	return card?.data?.organization_name?.trim() || undefined;
}

function getHostFromPayload(payload: ExperiencePayloadContents): string | undefined {
	const block = findContent(payload, (c) => typeof c.data?.organization_name === `string`);
	return block?.data?.organization_name?.trim() || payload.analytic?.[`Creator Name`]?.trim() || undefined;
}

function getHostLink(payload: ExperiencePayloadContents): string | undefined {
	const block = findContent(payload, (c) => typeof c.data?.organization_link === `string` || typeof c.data?.link === `string`);
	const link = block?.data?.organization_link ?? block?.data?.link;
	if (typeof link !== `string` || !link.trim()) return undefined;
	if (link.startsWith(`http`)) return link;
	return `${SITE_BASE}${link.startsWith(`/`) ? link : `/${link}`}`;
}

function getTags(payload: ExperiencePayloadContents): string[] {
	const analytic = payload.analytic ?? {};
	const tags: string[] = [];
	const pushAll = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === `string` && item.trim()) tags.push(item.trim());
			}
			return;
		}
		if (typeof value === `string` && value.trim()) tags.push(value.trim());
	};
	pushAll(analytic.Category);
	pushAll(analytic.Interest);
	return [...new Set(tags)];
}

function getLatitude(payload: ExperiencePayloadContents): number | undefined {
	const loc = findContent(payload, (c) => c.meta?.lat != null);
	const lat = Number(loc?.meta?.lat);
	return Number.isFinite(lat) ? lat : undefined;
}

function getLongitude(payload: ExperiencePayloadContents): number | undefined {
	const loc = findContent(payload, (c) => c.meta?.lon != null || c.meta?.lng != null);
	const lon = Number(loc?.meta?.lon ?? loc?.meta?.lng);
	return Number.isFinite(lon) ? lon : undefined;
}

function getShortUrl(card: ContentCard): string | undefined {
	const deeplink = card.data?.action_deeplink?.trim();
	if (deeplink?.startsWith(`goersapp://event/`)) {
		return deeplink.slice(`goersapp://event/`.length) || undefined;
	}
	const link = card.data?.action_link?.trim();
	if (!link) return undefined;
	const parts = link.split(`--`);
	return parts.at(-1)?.replace(/\/$/, ``) || undefined;
}

function getSourceUrl(card: ContentCard): string | undefined {
	const link = card.data?.action_link?.trim();
	if (!link) return undefined;
	if (link.startsWith(`http`)) return link.split(`?`)[0];
	return `${SITE_BASE}${link.startsWith(`/`) ? link : `/${link}`}`;
}

async function fetchAllExploreCards(page: Page): Promise<ContentCard[]> {
	const cards: ContentCard[] = [];
	let pageNo = 1;
	let maxPage = 1;

	while (pageNo <= maxPage) {
		const data = await gql<ExplorePayload>({
			page,
			operationName: `exploreContents`,
			variables: {
				input: {
					keywords: null,
					type: `event`,
					page: pageNo,
					limit: PAGE_LIMIT,
					filterRegion: FILTER_REGION,
				},
			},
			query: EXPLORE_QUERY,
			origin: EXPLORE_URL,
		});
		const payload = data?.exploreContents;
		if (!payload) throw new Error(`GOERS exploreContents returned no data on page ${pageNo}`);

		const pagination = payload.meta?.pagination;
		maxPage = Math.max(1, Number(pagination?.max_page) || 1);
		for (const content of payload.contents ?? []) {
			if (content?.type !== `content-card`) continue;
			cards.push(content as ContentCard);
		}
		console.error(`  explore page ${pageNo}/${maxPage}: ${cards.length} cards so far`);
		pageNo += 1;
	}

	return cards;
}

async function gql<T>(args: {
	page: Page;
	operationName: string;
	variables: Record<string, unknown>;
	query: string;
	origin: string;
}): Promise<T | undefined> {
	const { page, operationName, variables, query, origin } = args;
	const result = await page.evaluate(
		async ({ apiUrl, salt, version, channel, operationName, variables, query, origin }) => {
			const sha1Hex = async (value: string) => {
				const digest = await crypto.subtle.digest(`SHA-1`, new TextEncoder().encode(value));
				return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, `0`)).join(``);
			};
			const cookies: Record<string, string> = {};
			for (const part of document.cookie.split(`; `).filter(Boolean)) {
				const i = part.indexOf(`=`);
				if (i < 0) continue;
				const key = part.slice(0, i);
				const raw = part.slice(i + 1);
				try {
					cookies[key] = decodeURIComponent(raw);
				} catch {
					cookies[key] = raw;
				}
			}
			const timestamp = Date.now();
			const signature = await sha1Hex(`${origin}${timestamp}${salt}`);
			const token = cookies.goers_session ?? ``;
			const response = await fetch(apiUrl, {
				method: `POST`,
				credentials: `include`,
				headers: {
					[`content-type`]: `application/json`,
					[`accept-language`]: `en`,
					[`time-zone`]: Intl.DateTimeFormat().resolvedOptions().timeZone || `Asia/Makassar`,
					[`g-app-version`]: version,
					[`g-channel`]: channel,
					[`g-origin`]: origin,
					[`g-signature`]: signature,
					[`g-data`]: JSON.stringify({ agent: navigator.userAgent, origin, client: `` }),
					timestamp: String(timestamp),
					...(token ? { authorization: `Bearer ${token}` } : {}),
					[`apollographql-client-name`]: `goers-website`,
					[`apollographql-client-version`]: version,
				},
				body: JSON.stringify({ operationName, variables, query }),
			});
			const text = await response.text();
			let json: any;
			try {
				json = text ? JSON.parse(text) : undefined;
			} catch {
				return {
					status: response.status,
					json: {
						errors: [
							{
								message: `Non-JSON GraphQL response (${response.status}): ${text.slice(0, 120)}`,
							},
						],
					},
				};
			}
			return { status: response.status, json };
		},
		{
			apiUrl: API_URL,
			salt: API_SALT,
			version: APP_VERSION,
			channel: APP_CHANNEL,
			operationName,
			variables,
			query,
			origin,
		},
	);

	if (result.status >= 400 || result.json?.errors?.length) {
		const message = result.json?.errors?.[0]?.message ?? `HTTP ${result.status}`;
		throw new Error(`GOERS ${operationName} failed: ${message}`);
	}
	return result.json?.data as T | undefined;
}

async function launchChrome(): Promise<Browser> {
	// Headed Chrome is required: Playwright headless-shell / channel-chrome
	// headless both get Queue-it / Cloudflare challenged. On CI wrap the process
	// with xvfb-run (see scrape-source.yml) so $DISPLAY exists.
	return await chromium.launch({
		channel: `chrome`,
		headless: false,
		args: [
			`--disable-blink-features=AutomationControlled`,
			`--no-sandbox`,
			`--disable-dev-shm-usage`,
		],
	});
}

async function openGuestPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext({
		locale: `id-ID`,
		timezoneId: TIMEZONE,
		viewport: { width: 1365, height: 900 },
	});
	await context.addInitScript(() => {
		Object.defineProperty(navigator, `webdriver`, { get: () => undefined });
	});
	return await context.newPage();
}

async function warmExploreSession(page: Page): Promise<void> {
	const exploreSeen = page.waitForResponse(
		(res) =>
			res.url().includes(`graph.goersapp.com/v2`) &&
			res.request().method() === `POST` &&
			(res.request().postData() ?? ``).includes(`exploreContents`) &&
			res.status() === 200,
		{ timeout: 90_000 },
	);

	await page.goto(EXPLORE_URL, { waitUntil: `domcontentloaded`, timeout: 90_000 });

	try {
		await exploreSeen;
	} catch {
		// Fall through — we'll probe GraphQL ourselves once the guest cookie exists.
	}

	const startedAt = Date.now();
	const deadline = startedAt + 60_000;
	while (Date.now() < deadline) {
		try {
			const title = await page.title();
			if (/connection interrupted/i.test(title)) {
				throw new Error(`GOERS Queue-it / bot check interrupted the session (title: ${title})`);
			}
			const state = await page.evaluate(() => {
				const text = document.body?.innerText ?? ``;
				return {
					ready:
						/events await/i.test(text) || document.querySelectorAll(`a[href*="/events/"]`).length > 0,
					hasSession: document.cookie.includes(`goers_session=`),
				};
			});
			if (state.ready || (state.hasSession && Date.now() - startedAt > 8_000)) {
				if (await probeExploreContents(page)) return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/Execution context was destroyed|navigation/i.test(message)) throw error;
		}
		await sleep(500);
	}
	throw new Error(`GOERS explore page did not become ready in time`);
}

async function probeExploreContents(page: Page): Promise<boolean> {
	try {
		const data = await gql<ExplorePayload>({
			page,
			operationName: `exploreContents`,
			variables: {
				input: {
					keywords: null,
					type: `event`,
					page: 1,
					limit: 1,
					filterRegion: FILTER_REGION,
				},
			},
			query: EXPLORE_QUERY,
			origin: EXPLORE_URL,
		});
		return !!data?.exploreContents;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`GOERS explore probe not ready yet: ${message}`);
		return false;
	}
}

function eventSchema(payload: ExperiencePayloadContents): EventSchema | undefined {
	for (const item of payload.meta?.schema ?? []) {
		const type = item?.[`@type`];
		const isEvent =
			type === `Event` || (Array.isArray(type) && type.includes(`Event`));
		if (isEvent) return item as EventSchema;
	}
	return undefined;
}

function firstPlace(location: EventSchema[`location`]): EventPlace | undefined {
	if (!location) return undefined;
	if (Array.isArray(location)) return location[0];
	return location;
}

function findContent(
	payload: ExperiencePayloadContents,
	pred: (content: GoersContent) => boolean,
): GoersContent | undefined {
	for (const content of payload.contents ?? []) {
		if (content && pred(content)) return content;
	}
	return undefined;
}

function localDateTimeToIso(args: { local: string; offset: string }): string | undefined {
	const { local, offset } = args;
	// "2026-11-28 04:30:00" -> "2026-11-28T04:30:00+08:00"
	const normalized = local.trim().replace(` `, `T`);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return undefined;
	const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(normalized)
		? normalized
		: `${normalized}:00`;
	return `${withSeconds}${offset}`;
}

function parseCardJson(html: string): ContentCard | undefined {
	try {
		return JSON.parse(html) as ContentCard;
	} catch {
		return undefined;
	}
}

function parsePayloadJson(html: string): ExperiencePayloadContents {
	try {
		return JSON.parse(html) as ExperiencePayloadContents;
	} catch {
		return { contents: [], meta: {}, analytic: {} };
	}
}

// sha1 helper kept for tests / future HTTP-only path; browser uses SubtleCrypto.
export function signGoersRequest(args: { origin: string; timestamp: number; salt?: string }): string {
	const { origin, timestamp, salt = API_SALT } = args;
	return createHash(`sha1`).update(`${origin}${timestamp}${salt}`).digest(`hex`);
}

if (import.meta.main) {
	const scraper = new WebsiteScraper();
	const events = await scraper.scrapeWebsite();
	console.log(JSON.stringify(events, null, 2));
}

type ContentCard = {
	type: string;
	data?: {
		name?: string;
		image?: string;
		organization_name?: string;
		location?: string;
		price?: string;
		price_caption?: string;
		action_link?: string;
		action_deeplink?: string;
	};
	analytic?: Record<string, unknown>;
};

type GoersContent = {
	type?: string;
	data?: Record<string, any>;
	meta?: Record<string, any>;
	analytic?: Record<string, any>;
};

type ExperiencePayloadContents = {
	meta?: {
		title?: string;
		description?: string;
		image?: string;
		short_url?: string;
		galleries?: string[];
		schema?: Array<Record<string, any>>;
	};
	analytic?: Record<string, any>;
	contents?: GoersContent[];
};

type ExperiencePayload = {
	experienceContents?: ExperiencePayloadContents;
};

type ExplorePayload = {
	exploreContents?: {
		meta?: { pagination?: { current_page?: number; limit?: number; max_page?: number; total?: number } };
		contents?: GoersContent[];
	};
};

type EventPlace = {
	name?: string;
	address?: {
		streetAddress?: string;
		addressLocality?: string;
		addressRegion?: string;
		addressCountry?: string;
	};
};

type EventSchema = {
	name?: string;
	startDate?: string;
	endDate?: string;
	priceRange?: string;
	image?: string | string[];
	location?: EventPlace | EventPlace[];
};
