/**
 * Scrapes Bali Travel Hub events (`/events/` WP posts).
 *
 * Listing: WP REST `posts?categories=6` (Events), excluding Public Holidays (`categories_exclude=598`).
 * Detail: each `/events/{slug}/` page — prefer `#hp-event` Festival/Event JSON-LD,
 * fall back to `article:published_time` in Asia/Jakarta when schema dates are missing or past.
 * Public Holidays posts are skipped (Christmas, Labour Day, …).
 *
 * Usage:
 *   bun run scripts/scrape-balitravelhub.ts
 *   bun run scripts/scrape-balitravelhub.ts --limit 10
 *   bun run scripts/scrape-balitravelhub.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://www.balitravelhub.com`;
const EVENTS_CATEGORY_ID = 6;
/** WP category for national/religious public holidays (Christmas, Labour Day, …). */
const PUBLIC_HOLIDAYS_CATEGORY_ID = 598;
const WP_POSTS_URL = `${SITE_BASE}/wp-json/wp/v2/posts`;
const DEFAULT_TIMEZONE = `Asia/Jakarta` as const;
const SOURCE = `balitravelhub` as const;
const DETAIL_DELAY_MS = 250;
const WP_PAGE_SIZE = 100;
/** Island-wide fallback used by many BTH Event schemas. */
const BALI_LAT = -8.4095178;
const BALI_LNG = 115.188919;
const EVENT_LD_TYPES = new Set([
	`Event`,
	`Festival`,
	`MusicEvent`,
	`SocialEvent`,
	`SportsEvent`,
	`TheaterEvent`,
	`EducationEvent`,
	`BusinessEvent`,
]);
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
			`Fetching Bali Travel Hub events via WP REST${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let urls: string[];
		try {
			urls = await fetchEventUrls({ limit: resolvedLimit });
		} catch (error) {
			console.error(`Failed to list Bali Travel Hub events:`, error);
			return [];
		}
		console.error(`Found ${urls.length} event URLs. Loading detail pages...`);

		const events: ScrapedEvent[] = [];
		for (const url of urls) {
			try {
				const html = await customFetch(url, { returnType: `text` });
				const event = await this.extractEventData(html, url);
				if (event) events.push(event);
				await sleep(DETAIL_DELAY_MS);
			} catch (error) {
				console.error(`Failed to process ${url}:`, error);
			}
		}

		events.sort((a, b) => a.startAt.localeCompare(b.startAt));
		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const url = inferFileUrl(filePath);
				const event = await this.extractEventData(html, url);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapBaliTravelHubEvent({ html, url });
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
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

export async function mapBaliTravelHubEvent(args: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const { html, url } = args;
	if (isPublicHoliday(html)) {
		console.error(`Skipping ${url} (Public Holidays category).`);
		return undefined;
	}

	const name = getName(html);
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl({ html, url });
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	const endAt = getEndAt(html);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	const address = getAddress(html);
	let latitude = getLatitude(html);
	let longitude = getLongitude(html);
	let timezone: string | null = DEFAULT_TIMEZONE;

	if (
		(latitude == null || longitude == null) &&
		address?.length &&
		!isGenericBaliAddress(address)
	) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			latitude = latitude ?? geocoded?.lat ?? null;
			longitude = longitude ?? geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${sourceUrl}:`, error);
		}
	}

	if (latitude == null || longitude == null) {
		latitude = latitude ?? BALI_LAT;
		longitude = longitude ?? BALI_LNG;
	}

	return {
		name,
		startAt,
		endAt,
		timezone,
		address,
		price: getPrice(html),
		priceIsHtml: false,
		description: getDescription(html),
		imageUrls: getImageUrls(html),
		host: getHost(html),
		hostLink: getHostLink(html),
		contact: getContact(html),
		latitude,
		longitude,
		tags: getTags(html),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export async function fetchEventUrls({ limit }: { limit?: number } = {}): Promise<string[]> {
	const urls: string[] = [];
	let page = 1;

	while (true) {
		const perPage = limit ? Math.min(WP_PAGE_SIZE, limit - urls.length) : WP_PAGE_SIZE;
		if (perPage < 1) break;

		const apiUrl =
			`${WP_POSTS_URL}?categories=${EVENTS_CATEGORY_ID}` +
			`&categories_exclude=${PUBLIC_HOLIDAYS_CATEGORY_ID}` +
			`&per_page=${perPage}&page=${page}&orderby=date&order=asc&_fields=link,slug,categories`;
		const posts = (await customFetch(apiUrl, { returnType: `json` })) as WpPostListItem[];
		if (!Array.isArray(posts) || !posts?.length) break;

		for (const post of posts) {
			if (post.categories?.includes(PUBLIC_HOLIDAYS_CATEGORY_ID)) continue;
			const link = canonicalizeEventUrl(post?.link);
			if (!link) continue;
			urls.push(link);
			if (limit && urls.length >= limit) return urls;
		}

		if (posts.length < perPage) break;
		page += 1;
		await sleep(DETAIL_DELAY_MS);
	}

	return urls;
}

export function getName(html: string): string | undefined {
	const $ = cheerio.load(html);
	const h1 = superTrim($(`h1.entry-title`).first().text()) || superTrim($(`h1`).first().text());
	if (h1) return h1;

	const ldName = readEvent(html)?.name;
	return superTrim(typeof ldName === `string` ? ldName : undefined) || undefined;
}

export function getStartAt(html: string): string | undefined {
	const schemaStart = parseSchemaDate(readEvent(html)?.startDate);
	const schemaEnd = parseSchemaDate(readEvent(html)?.endDate);
	if (schemaStart && isUpcoming({ startAt: schemaStart, endAt: schemaEnd })) {
		return schemaStart;
	}
	return publishedTimeToStartAt(html);
}

export function getEndAt(html: string): string | undefined {
	const schemaStart = parseSchemaDate(readEvent(html)?.startDate);
	const schemaEnd = parseSchemaDate(readEvent(html)?.endDate);
	if (!schemaStart || !schemaEnd) return undefined;
	if (!isUpcoming({ startAt: schemaStart, endAt: schemaEnd })) return undefined;

	const startAt = getStartAt(html);
	// Only keep schema end when start also came from schema (not published fallback).
	if (!startAt || startAt !== schemaStart) return undefined;
	if (new Date(schemaEnd).getTime() <= new Date(schemaStart).getTime()) return undefined;
	return schemaEnd;
}

export function getAddress(html: string): string[] {
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

	const location = readEvent(html)?.location;
	const place = Array.isArray(location) ? location[0] : location;
	if (place && typeof place === `object` && place[`@type`] !== `VirtualLocation`) {
		push(typeof place.name === `string` ? place.name : undefined);
		const address = place.address;
		if (typeof address === `string`) {
			for (const part of address.split(/,/)) push(part);
		} else if (address && typeof address === `object`) {
			push(typeof address.streetAddress === `string` ? address.streetAddress : undefined);
			push(
				[address.postalCode, address.addressLocality]
					.filter((part): part is string => typeof part === `string` && Boolean(part.trim()))
					.join(` `),
			);
			const country = typeof address.addressCountry === `string` ? address.addressCountry.trim() : ``;
			if (country && !/^(id|indonesia)$/i.test(country)) push(country);
		}
	}

	if (!lines?.length) {
		push(`Bali`);
		push(`Indonesia`);
	}

	return lines;
}

export function getPrice(html: string): string | undefined {
	const $ = cheerio.load(html);
	const faqText = $(`#hp-faq, [id*="hp-faq"]`).text() || ``;
	const freeMatch = faqText.match(/is\s+[^.?]{0,80}\s+free\??\s*(yes[.!]?)?/i);
	if (freeMatch && /yes/i.test(freeMatch[0] + (freeMatch[1] ?? ``))) return `Free`;

	const body = $(`.entry-content`).first().text();
	if (/\bfree general admission\b/i.test(body) || /\bfree entry\b/i.test(body)) return `Free`;
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const content = $(`.entry-content`).first().clone();
	if (!content.length) {
		const ld = readEvent(html)?.description;
		if (typeof ld === `string` && ld.trim()) {
			return cleanProseHtml(`<p>${escapeHtml(ld.trim())}</p>`) || undefined;
		}
		return undefined;
	}

	content.find(`script, style, .hp-faq, #hp-faq, .hp-upcoming-events, .sharedaddy`).remove();
	let cleaned = cleanProseHtml(content.html());
	if (!cleaned?.trim()) return undefined;
	// WP shortcode placeholders leave empty comment-only divs.
	cleaned = cleaned.replace(/<div>\s*<!--[\s\S]*?-->\s*<\/div>\s*/g, ``).trim();
	return cleaned || undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		if (!/^https?:\/\//i.test(text)) return;
		if (/logo|favicon|apple-touch|gravatar/i.test(text)) return;
		const key = text.split(`?`)[0].toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		urls.push(text);
	};

	const $ = cheerio.load(html);
	add($(`meta[property="og:image"]`).attr(`content`));

	const image = readEvent(html)?.image;
	if (typeof image === `string`) add(image);
	else if (image && typeof image === `object` && typeof image.url === `string`) add(image.url);

	const primary = readLdNode(html, (node) => {
		const id = typeof node[`@id`] === `string` ? node[`@id`] : ``;
		return id.endsWith(`#primaryimage`);
	});
	if (primary && typeof primary.url === `string`) add(primary.url);

	return urls;
}

export function getHost(_html: string): string | undefined {
	// Editorial calendar — BTH is not the event organizer.
	return undefined;
}

export function getHostLink(_html: string): string | undefined {
	return undefined;
}

export function isPublicHoliday(html: string): boolean {
	const article = readLdNode(html, (node) => node[`@type`] === `Article`);
	const sections = article?.articleSection;
	if (Array.isArray(sections)) {
		if (sections.some((section) => isPublicHolidayLabel(section))) return true;
	} else if (isPublicHolidayLabel(sections)) {
		return true;
	}

	const $ = cheerio.load(html);
	if ($(`.meta-category a, a[rel="category tag"]`).toArray().some((el) => isPublicHolidayLabel($(el).text()))) {
		return true;
	}
	const bodyClass = $(`body`).attr(`class`) || ``;
	return /\bcategory-public-holidays\b/i.test(bodyClass);
}

export function getTags(html: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		if (/^events?$/i.test(text)) return;
		if (isPublicHolidayLabel(text)) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(text);
	};

	const article = readLdNode(html, (node) => node[`@type`] === `Article`);
	const sections = article?.articleSection;
	if (Array.isArray(sections)) {
		for (const section of sections) {
			if (typeof section === `string`) add(section);
		}
	} else if (typeof sections === `string`) {
		add(sections);
	}

	const $ = cheerio.load(html);
	$(`.meta-category a, a[rel="category tag"]`).each((_i, el) => add($(el).text()));

	const ldType = readEvent(html)?.[`@type`];
	if (typeof ldType === `string` && ldType !== `Event`) add(ldType);
	else if (Array.isArray(ldType)) {
		for (const type of ldType) {
			if (typeof type === `string` && type !== `Event`) add(type);
		}
	}

	return tags;
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined) => {
		const value = superTrim(raw);
		if (!value) return;
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	push(SITE_BASE);
	const $ = cheerio.load(html);
	$(`.entry-content a[href]`).each((_i, el) => {
		const href = $(el).attr(`href`);
		if (!href) return;
		if (href.startsWith(`mailto:`)) {
			push(href.slice(`mailto:`.length));
			return;
		}
		if (/wa\.me|api\.whatsapp\.com|t\.me|telegram\.me/i.test(href)) push(href);
	});

	return contacts;
}

export function getSourceUrl(args: { html: string; url: string }): string | undefined {
	const { html, url } = args;
	const canonical = cheerio.load(html)(`link[rel="canonical"]`).attr(`href`);
	return canonicalizeEventUrl(canonical) || canonicalizeEventUrl(url);
}

export function getLatitude(html: string): number | null {
	const geo = readEventGeo(html);
	return typeof geo?.latitude === `number` && Number.isFinite(geo.latitude) ? geo.latitude : null;
}

export function getLongitude(html: string): number | null {
	const geo = readEventGeo(html);
	return typeof geo?.longitude === `number` && Number.isFinite(geo.longitude) ? geo.longitude : null;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	const files: string[] = [];
	let limit: number | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === `--limit` || arg === `-n`) {
			limit = parseLimitValue(argv[++i]);
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			limit = parseLimitValue(arg.slice(`--limit=`.length));
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

function parseLimitValue(raw: string | undefined): number {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --limit: ${raw}`);
	return parsed;
}

function readEvent(html: string): LdEvent | undefined {
	for (const node of ldNodesFromHtml(html)) {
		const types = typeSet(node[`@type`]);
		if ([...types].some((type) => EVENT_LD_TYPES.has(type))) return node;
	}
	return undefined;
}

function readEventGeo(html: string): { latitude?: number; longitude?: number } | undefined {
	const location = readEvent(html)?.location;
	const place = Array.isArray(location) ? location[0] : location;
	if (!place || typeof place !== `object`) return undefined;
	const geo = place.geo;
	if (!geo || typeof geo !== `object`) return undefined;
	return {
		latitude: toFiniteNumber(geo.latitude),
		longitude: toFiniteNumber(geo.longitude),
	};
}

function readLdNode(
	html: string,
	predicate: (node: LdNode) => boolean,
): LdNode | undefined {
	for (const node of ldNodesFromHtml(html)) {
		if (predicate(node)) return node;
	}
	return undefined;
}

function ldNodesFromHtml(html: string): LdNode[] {
	const $ = cheerio.load(html);
	const nodes: LdNode[] = [];
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).html() || $(el).text();
		if (!text?.trim()) continue;
		try {
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as unknown;
			nodes.push(...ldNodes(parsed));
		} catch (error) {
			console.error(`JSON-LD is not valid JSON:`, error);
		}
	}
	return nodes;
}

function ldNodes(parsed: unknown): LdNode[] {
	if (Array.isArray(parsed)) {
		return parsed.flatMap((item) => ldNodes(item));
	}
	if (!parsed || typeof parsed !== `object`) return [];
	const node = parsed as LdNode;
	const graph = node[`@graph`];
	if (Array.isArray(graph)) return graph.flatMap((item) => ldNodes(item));
	return [node];
}

function typeSet(value: unknown): Set<string> {
	if (typeof value === `string`) return new Set([value]);
	if (Array.isArray(value)) {
		return new Set(value.filter((item): item is string => typeof item === `string`));
	}
	return new Set();
}

function parseSchemaDate(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnly) {
		const year = Number(dateOnly[1]);
		const month = Number(dateOnly[2]);
		const day = Number(dateOnly[3]);
		return dateToIsoStr(year, month, day, 0, 0, DEFAULT_TIMEZONE, false);
	}

	const withTime = trimmed.match(
		/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/,
	);
	if (withTime) {
		const year = Number(withTime[1]);
		const month = Number(withTime[2]);
		const day = Number(withTime[3]);
		const hour = Number(withTime[4]);
		const minute = Number(withTime[5]);
		// Schema datetimes on this site are calendar dates in Bali; ignore zone suffix.
		return dateToIsoStr(year, month, day, hour, minute, DEFAULT_TIMEZONE, false);
	}

	return undefined;
}

function publishedTimeToStartAt(html: string): string | undefined {
	const $ = cheerio.load(html);
	const published =
		$(`meta[property="article:published_time"]`).attr(`content`) ||
		$(`meta[property="og:updated_time"]`).attr(`content`);
	if (!published) return undefined;

	const ms = Date.parse(published);
	if (Number.isNaN(ms)) return undefined;

	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone: DEFAULT_TIMEZONE,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(new Date(ms));
	const year = Number(parts.find((part) => part.type === `year`)?.value);
	const month = Number(parts.find((part) => part.type === `month`)?.value);
	const day = Number(parts.find((part) => part.type === `day`)?.value);
	if (!year || !month || !day) return undefined;
	return dateToIsoStr(year, month, day, 0, 0, DEFAULT_TIMEZONE, false);
}

function isUpcoming(args: { startAt: string; endAt?: string | null }): boolean {
	const { startAt, endAt } = args;
	const endMs = new Date(endAt || startAt).getTime();
	if (Number.isNaN(endMs)) return false;
	return endMs >= Date.now() - 12 * 60 * 60 * 1000;
}

function isGenericBaliAddress(address: string[]): boolean {
	if (!address?.length) return true;
	const joined = address.join(` `).toLowerCase();
	return /^(bali(,?\s*indonesia)?|indonesia)$/i.test(joined.trim());
}

function isPublicHolidayLabel(value: unknown): boolean {
	if (typeof value !== `string`) return false;
	return /^public[- ]holidays?$/i.test(value.trim());
}

function canonicalizeEventUrl(raw: string | undefined): string | undefined {
	if (!raw?.trim()) return undefined;
	try {
		const url = new URL(raw, SITE_BASE);
		if (!url.hostname.endsWith(`balitravelhub.com`)) return undefined;
		const match = url.pathname.match(/^\/events\/([a-z0-9-]+)\/?$/i);
		if (!match) return undefined;
		const slug = match[1].toLowerCase();
		if (slug === `page` || slug === `public-holidays`) return undefined;
		return `${SITE_BASE}/events/${slug}/`;
	} catch {
		return undefined;
	}
}

function inferFileUrl(filePath: string): string {
	const base = filePath.split(`/`).pop() || `event`;
	const slug = base.replace(/\.(html?|txt)$/i, ``);
	return `${SITE_BASE}/events/${slug}/`;
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value === `string` && value.trim()) {
		const amount = Number(value);
		if (Number.isFinite(amount)) return amount;
	}
	return undefined;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

if (import.meta.main) {
	try {
		const { limit, files } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length
			? await scraper.scrapeHtmlFiles(limit ? files.slice(0, limit) : files)
			: await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
		console.error(`Collected ${events.length} events.`);
		process.exit(0);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type WpPostListItem = {
	link?: string;
	slug?: string;
	categories?: number[];
};

type LdGeo = {
	[`@type`]?: string;
	latitude?: number | string;
	longitude?: number | string;
};

type LdPostalAddress = {
	[`@type`]?: string;
	streetAddress?: string;
	addressLocality?: string;
	postalCode?: string;
	addressCountry?: string;
};

type LdPlace = {
	[`@type`]?: string;
	name?: string;
	address?: string | LdPostalAddress;
	geo?: LdGeo;
};

type LdEvent = LdNode & {
	name?: string;
	startDate?: string;
	endDate?: string;
	description?: string;
	image?: string | { url?: string };
	location?: LdPlace | LdPlace[];
};

type LdNode = {
	[`@type`]?: string | string[];
	[`@id`]?: string;
	[`@graph`]?: unknown;
	url?: string;
	articleSection?: string | string[];
	[key: string]: unknown;
};
