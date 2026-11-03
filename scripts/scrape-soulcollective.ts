/**
 * Scrapes Soul Collective Berlin conscious events (Squarespace).
 *
 * Prefers JSON APIs over HTML:
 * - Listing: `/conscious-events-in-berlin?format=json` → `upcoming` (full items, pageSize 30)
 * - Month index: `/api/open/GetItemsByMonth?month=MMMM-yyyy&collectionId=…` (thin items)
 * - Detail: `{fullUrl}?format=json` → `item` (used when month index finds URLs missing from listing)
 *
 * Usage:
 *   bun run scripts/scrape-soulcollective.ts
 *   bun run scripts/scrape-soulcollective.ts --limit 10
 *   bun run scripts/scrape-soulcollective.ts <json_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://www.soulcollective.eu`;
const LISTING_PATH = `/conscious-events-in-berlin`;
const LISTING_JSON_URL = `${SITE_BASE}${LISTING_PATH}?format=json`;
const COLLECTION_ID = `619d181fde933516ddcbe7da`;
const SOURCE = `soulcollective` as const;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const MONTHS_AHEAD = 6;
const DETAIL_DELAY_MS = 200;
const RUNNER_FLAGS = new Set([
	`--clean`,
	`--dry-run`,
	`--write-baseline`,
	`--exclude`,
	`--log-dir`,
]);
const MONTH_NAMES = [
	`January`,
	`February`,
	`March`,
	`April`,
	`May`,
	`June`,
	`July`,
	`August`,
	`September`,
	`October`,
	`November`,
	`December`,
] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Soul Collective events via Squarespace JSON${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let items: SoulCollectiveItem[];
		try {
			items = await fetchUpcomingItems({ limit: resolvedLimit });
		} catch (error) {
			console.error(`Failed to fetch Soul Collective events:`, error);
			return [];
		}
		console.error(`Loaded ${items.length} event payloads. Mapping...`);

		const events: ScrapedEvent[] = [];
		for (const item of items) {
			try {
				const event = await mapSoulCollectiveEvent(item);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Failed to process ${item?.fullUrl ?? item?.id}:`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const raw = await Bun.file(filePath).text();
				const items = parsePayloadItems(raw);
				for (const item of items) {
					try {
						const event = await mapSoulCollectiveEvent(item);
						if (event) events.push(event);
					} catch (error) {
						console.error(`Failed to process item from ${filePath}:`, error);
					}
				}
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, _url: string): Promise<ScrapedEvent | undefined> {
		try {
			const items = parsePayloadItems(html);
			if (!items?.length) return undefined;
			return await mapSoulCollectiveEvent(items[0]);
		} catch (error) {
			console.error(`Error extracting event data:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName(firstItem(html));
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt(firstItem(html));
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt(firstItem(html));
	}
	extractAddress(html: string): string[] | undefined {
		return getAddress(firstItem(html));
	}
	extractPrice(html: string): string | undefined {
		return getPrice(firstItem(html));
	}
	extractDescription(html: string): string | undefined {
		return getDescription(firstItem(html));
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls(firstItem(html));
	}
	extractHost(html: string): string | undefined {
		return getHost(firstItem(html));
	}
	extractHostLink(html: string): string | undefined {
		return getHostLink(firstItem(html));
	}
	extractTags(html: string): string[] | undefined {
		return getTags(firstItem(html));
	}
}

export async function mapSoulCollectiveEvent(
	item: SoulCollectiveItem | undefined,
): Promise<ScrapedEvent | undefined> {
	if (!item) return undefined;

	const name = getName(item);
	const startAt = getStartAt(item);
	const sourceUrl = getSourceUrl(item);
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${sourceUrl ?? item.fullUrl ?? item.id} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	const endAt = getEndAt(item);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	const address = getAddress(item);
	let latitude = getLatitude(item);
	let longitude = getLongitude(item);
	let timezone: string | null = DEFAULT_TIMEZONE;

	if (latitude == null && longitude == null && address?.length && !isOnlineAddress(address)) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			latitude = geocoded?.lat ?? null;
			longitude = geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${sourceUrl}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt,
		timezone,
		address,
		price: getPrice(item),
		priceIsHtml: false,
		description: getDescription(item),
		imageUrls: getImageUrls(item),
		host: getHost(item),
		hostLink: getHostLink(item),
		contact: getContact(item),
		latitude,
		longitude,
		tags: getTags(item),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export async function fetchUpcomingItems({
	limit,
}: {
	limit?: number;
} = {}): Promise<SoulCollectiveItem[]> {
	const listing = (await customFetch(LISTING_JSON_URL, { returnType: `json` })) as ListingJson;
	const byUrl = new Map<string, SoulCollectiveItem>();

	for (const item of listing?.upcoming ?? []) {
		const url = absoluteEventUrl(item?.fullUrl);
		if (!url || !item) continue;
		byUrl.set(url, item);
	}

	const monthSummaries = await fetchMonthSummaries();
	const missingUrls: string[] = [];
	for (const summary of monthSummaries) {
		const url = absoluteEventUrl(summary?.fullUrl);
		if (!url) continue;
		if (byUrl.has(url)) continue;
		missingUrls.push(url);
	}

	console.error(
		`Listing upcoming=${byUrl.size}; month index=${monthSummaries.length}; detail fetches=${missingUrls.length}`,
	);

	for (const url of missingUrls) {
		try {
			const detail = (await customFetch(`${url}?format=json`, { returnType: `json` })) as DetailJson;
			if (detail?.item) byUrl.set(url, detail.item);
			await sleep(DETAIL_DELAY_MS);
		} catch (error) {
			console.error(`Failed to fetch detail ${url}:`, error);
		}
	}

	const items = [...byUrl.values()].sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
	if (limit) return items.slice(0, limit);
	return items;
}

export async function fetchMonthSummaries(): Promise<MonthSummary[]> {
	const summaries: MonthSummary[] = [];
	const seen = new Set<string>();
	const now = new Date();

	for (let offset = 0; offset < MONTHS_AHEAD; offset++) {
		const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
		const monthName = MONTH_NAMES[cursor.getUTCMonth()];
		const year = cursor.getUTCFullYear();
		const url =
			`${SITE_BASE}/api/open/GetItemsByMonth?month=${monthName}-${year}&collectionId=${COLLECTION_ID}`;
		try {
			const items = (await customFetch(url, { returnType: `json` })) as MonthSummary[];
			if (!Array.isArray(items)) continue;
			for (const item of items) {
				const fullUrl = absoluteEventUrl(item?.fullUrl);
				if (!fullUrl || seen.has(fullUrl)) continue;
				seen.add(fullUrl);
				summaries.push(item);
			}
		} catch (error) {
			console.error(`Failed month index ${monthName}-${year}:`, error);
		}
		await sleep(DETAIL_DELAY_MS);
	}

	return summaries;
}

export function getName(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	return decodeText(item.title) || undefined;
}

export function getStartAt(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	return epochMsToIso(item.structuredContent?.startDate ?? item.startDate);
}

export function getEndAt(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	const startAt = getStartAt(item);
	const endAt = epochMsToIso(item.structuredContent?.endDate ?? item.endDate);
	if (!endAt) return undefined;
	if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
}

export function getAddress(item: SoulCollectiveItem | undefined): string[] {
	if (!item) return [];
	const location = item.location;
	if (!location) return [];

	const title = decodeText(location.addressTitle);
	if (title && /^online$/i.test(title)) return [`Online`];

	const lines: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		lines.push(text);
	};

	push(title);
	push(decodeText(location.addressLine1));

	const line2 = decodeText(location.addressLine2);
	if (line2) {
		// Squarespace often uses "Berlin, BE, 12049" — split for cleaner lines.
		const parts = line2.split(`,`).map((part) => part.trim()).filter(Boolean);
		if (parts.length >= 2 && /^\d{4,5}$/.test(parts.at(-1) ?? ``)) {
			const postal = parts.at(-1)!;
			const region = parts.length >= 3 && /^[A-Z]{2}$/.test(parts.at(-2) ?? ``) ? parts.at(-2) : undefined;
			const cityParts = parts.slice(0, region ? -2 : -1);
			const city = [...new Set(cityParts.map((part) => part.trim()).filter(Boolean))].join(` `);
			push([city, postal].filter(Boolean).join(` `));
		} else {
			for (const part of parts) {
				if (/^[A-Z]{2}$/.test(part)) continue;
				push(part);
			}
		}
	}

	const country = decodeText(location.addressCountry);
	if (country && !/^(de|germany|deutschland)$/i.test(country)) push(country);

	return lines;
}

export function getPrice(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	const html = `${item.excerpt ?? ``}\n${item.body ?? ``}`;
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const textBlocks = $(`#root`)
		.find(`p, li`)
		.toArray()
		.map((el) => superTrim($(el).text()))
		.filter((text): text is string => Boolean(text));

	for (const text of textBlocks) {
		const ticketMatch = text.match(/^tickets?:\s*(.+)$/i);
		if (ticketMatch) {
			const price = normalizePriceText(ticketMatch[1]);
			if (price) return price;
		}
		const sliding = text.match(/sliding scale\s*(.+)$/i);
		if (sliding) {
			const price = normalizePriceText(sliding[0]);
			if (price) return price;
		}
	}

	const joined = textBlocks.join(` `);
	const euro = joined.match(/(?:tickets?:\s*)?((?:€\s*)?\d+[.,]?\d*\s*(?:€)?(?:\s*(?:to|–|-|—|\/)\s*(?:€\s*)?\d+[.,]?\d*\s*(?:€)?)?)/i);
	if (euro?.[1] && /€|\d/.test(euro[1])) {
		const price = normalizePriceText(euro[1]);
		if (price && /\d/.test(price)) return price;
	}

	return undefined;
}

export function getDescription(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	const body = item.body?.trim();
	if (body) {
		const $ = cheerio.load(body);
		const content = $(`.sqs-html-content`).first();
		const html = content.length ? content.html() : null;
		if (html?.trim()) {
			const cleaned = cleanProseHtml(html);
			if (cleaned?.trim()) return cleaned;
		}
		const cleanedBody = cleanProseHtml(body);
		if (cleanedBody?.trim()) return cleanedBody;
	}

	const excerpt = item.excerpt?.trim();
	if (!excerpt) return undefined;
	return cleanProseHtml(excerpt) || undefined;
}

export function getImageUrls(item: SoulCollectiveItem | undefined): string[] {
	if (!item?.assetUrl) return [];
	const url = item.assetUrl.trim();
	if (!url.startsWith(`http://`) && !url.startsWith(`https://`)) return [];
	return [url];
}

export function getHost(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	const html = `${item.body ?? ``}\n${item.excerpt ?? ``}`;
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const paragraphs = $(`#root p`)
		.toArray()
		.map((el) => superTrim($(el).text()))
		.filter((text): text is string => Boolean(text));

	for (const text of paragraphs) {
		const hosted = text.match(/^hosted by\s+(.+)$/i);
		if (!hosted) continue;
		let host = hosted[1].trim();
		host = host.replace(/\s+in collaboration with\b.*$/i, ``).trim();
		host = host.replace(/\s*,\s*co-author\b.*$/i, ``).trim();
		host = host.replace(/\s*\.\s*$/, ``).trim();
		if (host) return host;
	}

	return undefined;
}

export function getHostLink(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	const html = `${item.body ?? ``}\n${item.excerpt ?? ``}`;
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const hostedPara = $(`#root p`)
		.filter((_i, el) => /^hosted by\b/i.test(superTrim($(el).text()) ?? ``))
		.first();
	if (!hostedPara.length) return undefined;

	const href = hostedPara.find(`a[href]`).first().attr(`href`);
	if (!href) return undefined;
	if (href.startsWith(`mailto:`)) return undefined;
	return href.startsWith(`http`) ? href : undefined;
}

export function getContact(item: SoulCollectiveItem | undefined): string[] {
	if (!item) return [];
	const html = `${item.body ?? ``}\n${item.excerpt ?? ``}`;
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const contacts: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const value = superTrim(raw);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	$(`#root a[href]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		if (!href) return;
		if (href.startsWith(`mailto:`)) {
			add(href.slice(`mailto:`.length));
			return;
		}
		if (/instagram\.com|t\.me|wa\.me|telegram\.me/i.test(href)) add(href);
	});

	return contacts;
}

export function getTags(item: SoulCollectiveItem | undefined): string[] {
	if (!item) return [];
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const value = decodeText(raw);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(value);
	};

	for (const tag of item.tags ?? []) add(tag);
	for (const category of item.categories ?? []) add(category);
	if (isOnlineAddress(getAddress(item))) add(`Online`);
	return tags;
}

export function getSourceUrl(item: SoulCollectiveItem | undefined): string | undefined {
	if (!item) return undefined;
	return absoluteEventUrl(item.fullUrl);
}

export function getLatitude(item: SoulCollectiveItem | undefined): number | null {
	const lat = item?.location?.mapLat;
	return typeof lat === `number` && Number.isFinite(lat) ? lat : null;
}

export function getLongitude(item: SoulCollectiveItem | undefined): number | null {
	const lng = item?.location?.mapLng;
	return typeof lng === `number` && Number.isFinite(lng) ? lng : null;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	const files: string[] = [];
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
		files.push(arg);
	}

	return { limit, files };
}

export function parsePayloadItems(raw: string): SoulCollectiveItem[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith(`{`) || trimmed.startsWith(`[`)) {
		const data = JSON.parse(trimmed) as
			| SoulCollectiveItem
			| SoulCollectiveItem[]
			| ListingJson
			| DetailJson;
		if (Array.isArray(data)) return data.filter(isItem);
		if (isItem(data)) return [data];
		if (`item` in data && isItem(data.item)) return [data.item];
		if (`upcoming` in data && Array.isArray(data.upcoming)) {
			return data.upcoming.filter(isItem);
		}
		return [];
	}

	return [];
}

function firstItem(raw: string): SoulCollectiveItem | undefined {
	try {
		return parsePayloadItems(raw)[0];
	} catch {
		return undefined;
	}
}

function isItem(value: unknown): value is SoulCollectiveItem {
	return Boolean(value && typeof value === `object` && `title` in value && `fullUrl` in value);
}

function absoluteEventUrl(fullUrl: string | undefined): string | undefined {
	if (!fullUrl?.trim()) return undefined;
	if (fullUrl.startsWith(`http://`) || fullUrl.startsWith(`https://`)) return fullUrl.trim();
	if (!fullUrl.startsWith(`/`)) return undefined;
	return `${SITE_BASE}${fullUrl}`;
}

function epochMsToIso(ms: number | undefined): string | undefined {
	if (typeof ms !== `number` || !Number.isFinite(ms)) return undefined;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
}

function decodeText(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	const withEntities = cheerio.load(`<textarea>${value}</textarea>`)(`textarea`).text();
	return superTrim(withEntities) || undefined;
}

function normalizePriceText(raw: string): string | undefined {
	let text = superTrim(raw);
	if (!text) return undefined;
	text = text.replace(/\s+/g, ` `);
	text = text.replace(/(\d)\s*€/g, `$1€`).replace(/€\s*(\d)/g, `€$1`);
	if (/^(free|kostenlos)$/i.test(text)) return `Kostenlos`;
	return text || undefined;
}

function isOnlineAddress(address: string[]): boolean {
	return address.length === 1 && /^online$/i.test(address[0]);
}

function isUpcoming({ startAt, endAt }: { startAt: string; endAt?: string }): boolean {
	const endMs = endAt ? new Date(endAt).getTime() : NaN;
	const startMs = new Date(startAt).getTime();
	const anchor = Number.isFinite(endMs) ? endMs : startMs;
	return anchor >= Date.now() - 12 * 60 * 60 * 1000;
}

if (import.meta.main) {
	try {
		const { limit, files } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length
			? await scraper.scrapeHtmlFiles(files)
			: await scraper.scrapeWebsite(limit);
		console.log(events);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type SoulCollectiveLocation = {
	mapZoom?: number;
	mapLat?: number;
	mapLng?: number;
	addressTitle?: string;
	addressLine1?: string;
	addressLine2?: string;
	addressCountry?: string;
};

type SoulCollectiveItem = {
	id?: string;
	title?: string;
	fullUrl?: string;
	body?: string;
	excerpt?: string;
	assetUrl?: string;
	startDate?: number;
	endDate?: number;
	tags?: string[];
	categories?: string[];
	location?: SoulCollectiveLocation;
	structuredContent?: {
		_type?: string;
		startDate?: number;
		endDate?: number;
	};
};

type MonthSummary = {
	title?: string;
	fullUrl?: string;
	assetUrl?: string;
	excerpt?: string;
	location?: SoulCollectiveLocation;
	structuredContent?: {
		startDate?: number;
		endDate?: number;
	};
};

type ListingJson = {
	upcoming?: SoulCollectiveItem[];
	past?: SoulCollectiveItem[];
};

type DetailJson = {
	item?: SoulCollectiveItem;
};
