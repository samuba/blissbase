/**
 * Scrapes whatsnewindonesia.com Events via `/apiclient/article`
 * (`id_country=1&category=1&sort=soonest`), then enriches whitelist hits
 * from each article detail page (`content-wrapper`).
 *
 * Usage:
 *   bun run scripts/scrape-whatsnewindonesia.ts
 *   bun run scripts/scrape-whatsnewindonesia.ts --limit=5
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";
import { hasValidCoordinates } from "../src/lib/locationFilter.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	REQUEST_DELAY_MS,
	sleep,
	superTrim,
	type TimeZoneString,
} from "./common.ts";

const SITE_BASE = `https://whatsnewindonesia.com`;
const LIST_URL = `${SITE_BASE}/apiclient/article`;
const SOURCE = `whatsnewindonesia` as const;
const PAGE_SIZE = 50;
const MAX_PAGES = 50;
const UPCOMING_GRACE_MS = 24 * 60 * 60 * 1000;
const GEOCODE_BIAS = [`Indonesia`];

const CITY_TIMEZONE: Record<string, TimeZoneString> = {
	bali: `Asia/Makassar`,
	jakarta: `Asia/Jakarta`,
	bandung: `Asia/Jakarta`,
	yogyakarta: `Asia/Jakarta`,
	surabaya: `Asia/Jakarta`,
	others: `Asia/Jakarta`,
	overseas: `Asia/Jakarta`,
};

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
	bali: { lat: -8.4095178, lng: 115.188916 },
	jakarta: { lat: -6.2088, lng: 106.8456 },
	bandung: { lat: -6.9175, lng: 107.6191 },
	yogyakarta: { lat: -7.7956, lng: 110.3695 },
	surabaya: { lat: -7.2575, lng: 112.7521 },
};

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		console.error(
			`Fetching What's New Indonesia events${limit != null ? ` (limit ${limit})` : ``}...`,
		);

		const articles = await fetchAllEventArticles();
		const candidates = articles.filter((article) => passesNameLists(nameHaystack(article)));
		console.error(
			`Listed ${articles.length} dated events, ${candidates.length} matching the word lists`,
		);

		const kept: ScrapedEvent[] = [];
		const seen = new Set<string>();

		for (const article of candidates) {
			if (limit != null && kept.length >= limit) break;
			try {
				const sourceUrl = getSourceUrl(article);
				if (!sourceUrl || seen.has(sourceUrl)) continue;

				await sleep(REQUEST_DELAY_MS);
				const html = await customFetch(sourceUrl, { returnType: `text` });
				const mapped = await mapArticle({ article, html, sourceUrl });
				if (!mapped) continue;
				if (!isUpcomingStart({ startAt: mapped.startAt, now: Date.now() })) continue;

				seen.add(sourceUrl);
				kept.push(mapped);
			} catch (error) {
				console.error(`Failed to process WNI event ${article.id} (${article.title}):`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${kept.length} ---`);
		return kept;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const event = await this.extractEventData(html, filePath);
				if (!event) continue;
				allEvents.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return allEvents;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			const name = this.extractName(html);
			const startAt = this.extractStartAt(html);
			if (!name || !startAt) {
				console.error(`Skipping ${url} due to missing name or start date.`);
				return undefined;
			}

			return {
				name,
				startAt,
				endAt: this.extractEndAt(html),
				address: this.extractAddress(html) ?? [],
				price: this.extractPrice(html),
				priceIsHtml: false,
				description: this.extractDescription(html),
				imageUrls: this.extractImageUrls(html) ?? [],
				host: this.extractHost(html),
				hostLink: this.extractHostLink(html),
				contact: getContactFromHtml(html),
				latitude: undefined,
				longitude: undefined,
				timezone: `Asia/Jakarta`,
				tags: this.extractTags(html) ?? [],
				sourceUrl: url.startsWith(`http`) ? url : `${SITE_BASE}/`,
				source: SOURCE,
			} satisfies ScrapedEvent;
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getNameFromHtml(html);
	}

	extractStartAt(html: string): string | undefined {
		const meta = getMetaFromHtml(html);
		const city = getCitySlugFromHtml(html);
		return wallTimeToIso({
			date: meta?.start_date,
			time: meta?.start_time,
			timezone: timezoneForCity(city),
			eventDateUnix: meta?.event_date,
		});
	}

	extractEndAt(html: string): string | undefined {
		const meta = getMetaFromHtml(html);
		const city = getCitySlugFromHtml(html);
		const endAt = wallTimeToIso({
			date: meta?.end_date,
			time: meta?.end_time,
			timezone: timezoneForCity(city),
			eventDateUnix: meta?.event_date_end,
		});
		const startAt = this.extractStartAt(html);
		if (!endAt || !startAt) return endAt;
		if (new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
		return endAt;
	}

	extractAddress(html: string): string[] | undefined {
		const lines = getAddressFromHtml(html);
		return lines?.length ? lines : undefined;
	}

	extractPrice(html: string): string | undefined {
		return getPriceFromHtml(html);
	}

	extractDescription(html: string): string | undefined {
		return getDescriptionFromHtml(html);
	}

	extractImageUrls(html: string): string[] | undefined {
		const urls = getImageUrlsFromHtml(html);
		return urls.length ? urls : undefined;
	}

	extractHost(html: string): string | undefined {
		void html;
		return undefined;
	}

	extractHostLink(html: string): string | undefined {
		void html;
		return undefined;
	}

	extractTags(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const category = superTrim(
			$(`.breadcrumb a, [class*="category"]`)
				.filter((_, el) => {
					const text = $(el).text().toLowerCase();
					return text.includes(`event`) || text.includes(`nightlife`) || text.includes(`dining`);
				})
				.last()
				.text(),
		);
		if (!category || category.toLowerCase() === `events`) return [];
		return [category];
	}
}

export function passesNameLists(text: string | undefined): boolean {
	if (!text?.trim()) return false;
	if (matchesBlackListWords(text)) return false;
	return matchesWhiteListWords(text);
}

export function isUpcomingStart({ startAt, now }: { startAt: string; now: number }): boolean {
	const start = new Date(startAt).getTime();
	if (Number.isNaN(start)) return false;
	return start >= now - UPCOMING_GRACE_MS;
}

export function parseCliArgs(argv: string[]): { limit?: number } {
	let limit: number | undefined;
	for (const arg of argv) {
		const match = /^--limit=(\d+)$/.exec(arg);
		if (!match) continue;
		limit = Number(match[1]);
	}
	return { limit };
}

export async function mapArticle({
	article,
	html,
	sourceUrl,
}: {
	article: WniArticle;
	html: string;
	sourceUrl: string;
}): Promise<ScrapedEvent | undefined> {
	const name = getName(article);
	const startAt = getStartAt(article);
	if (!name || !startAt) return undefined;

	const timezone = getTimezone(article);
	const endAt = getEndAt(article);
	const address = getAddress({ article, html });
	const point = await resolvePoint({ article, address });

	return {
		name,
		startAt,
		endAt,
		timezone,
		address,
		price: getPrice({ article, html }),
		priceIsHtml: false,
		description: getDescription({ article, html }),
		imageUrls: getImageUrls(article),
		host: getHost(article),
		hostLink: getHostLink(article),
		contact: getContact({ article, html }),
		latitude: point?.lat,
		longitude: point?.lng,
		tags: getTags(article),
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export function getName(article: WniArticle): string | undefined {
	const name = superTrim(article.title);
	return name || undefined;
}

export function getStartAt(article: WniArticle): string | undefined {
	const meta = article.meta_data ?? {};
	return wallTimeToIso({
		date: readText(meta.start_date),
		time: readText(meta.start_time),
		timezone: getTimezone(article),
		eventDateUnix: readNumber(meta.event_date),
	});
}

export function getEndAt(article: WniArticle): string | undefined {
	const meta = article.meta_data ?? {};
	const endAt = wallTimeToIso({
		date: readText(meta.end_date),
		time: readText(meta.end_time),
		timezone: getTimezone(article),
		eventDateUnix: readNumber(meta.event_date_end),
	});
	const startAt = getStartAt(article);
	if (!endAt || !startAt) return endAt;
	if (new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
}

export function getTimezone(article: WniArticle): TimeZoneString {
	return timezoneForCity(article.slug_city);
}

export function getSourceUrl(article: WniArticle): string | undefined {
	const city = readText(article.slug_city);
	const slug = readText(article.slug);
	if (!city || !slug) return undefined;
	return `${SITE_BASE}/${city}/${slug}`;
}

export function getImageUrls(article: WniArticle): string[] {
	for (const key of [`featured_image_url`, `featured_image_16_9_url`, `featured_image_4_3_url`] as const) {
		const absolute = absoluteUploadUrl(article[key]);
		if (absolute) return [absolute];
	}
	return [];
}

export function getTags(article: WniArticle): string[] {
	const category = superTrim(article.category_name);
	if (!category) return [];
	if (category.toLowerCase() === `events`) return [];
	return [category];
}

export function getHost(_article: WniArticle): string | undefined {
	return undefined;
}

export function getHostLink(_article: WniArticle): string | undefined {
	return undefined;
}

export function getPrice({ article, html }: { article: WniArticle; html: string }): string | undefined {
	const metaPrice = article.meta_data?.price;
	const fromMeta = formatIdr(metaPrice);
	if (fromMeta) return fromMeta;
	return getPriceFromHtml(html);
}

export function getDescription({
	article,
	html,
}: {
	article: WniArticle;
	html: string;
}): string | undefined {
	const fromHtml = getDescriptionFromHtml(html);
	if (fromHtml) return fromHtml;

	const subtitle = superTrim(article.sub_title);
	if (subtitle) return cleanProseHtml(`<p>${escapeHtml(subtitle)}</p>`) || undefined;

	const metaDescription = readText(article.meta_data?.meta_description);
	if (metaDescription) return cleanProseHtml(`<p>${escapeHtml(metaDescription)}</p>`) || undefined;
	return undefined;
}

export function getAddress({ article, html }: { article: WniArticle; html: string }): string[] {
	const fromMeta = addressLinesFromHtml(readText(article.meta_data?.address));
	if (fromMeta?.length) return fromMeta;

	const venue = readText(article.meta_data?.venue);
	const fromHtml = getAddressFromHtml(html);
	if (fromHtml?.length) {
		if (venue && !fromHtml.some((line) => line.toLowerCase() === venue.toLowerCase())) {
			return [venue, ...fromHtml];
		}
		return fromHtml;
	}

	if (venue) {
		const cityBits = [article.name_city, article.name_country].map((part) => superTrim(part)).filter(Boolean) as string[];
		return [venue, ...cityBits];
	}

	const cityBits = [article.name_city, article.name_country].map((part) => superTrim(part)).filter(Boolean) as string[];
	return cityBits;
}

export function getContact({ article, html }: { article: WniArticle; html: string }): string[] {
	const contacts = new Set<string>();
	const ticket = readText(article.meta_data?.ticket);
	if (ticket?.startsWith(`http`)) contacts.add(ticket);

	for (const value of getContactFromHtml(html)) contacts.add(value);

	const addressHtml = readText(article.meta_data?.address);
	if (addressHtml) {
		for (const value of contactsFromSnippet(addressHtml)) contacts.add(value);
	}

	return [...contacts];
}

export function parseLatLong(value: unknown): { lat: number; lng: number } | undefined {
	const text = readText(value);
	if (!text) return undefined;
	const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
	if (!match) return undefined;
	const lat = Number(match[1]);
	const lng = Number(match[2]);
	if (!hasValidCoordinates({ lat, lng })) return undefined;
	return { lat, lng };
}

export function wallTimeToIso({
	date,
	time,
	timezone,
	eventDateUnix,
}: {
	date?: string | number | null;
	time?: string | null;
	timezone: TimeZoneString;
	eventDateUnix?: number;
}): string | undefined {
	if (typeof date === `string` && date.trim()) {
		const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
		if (dateMatch) {
			const year = Number(dateMatch[1]);
			const month = Number(dateMatch[2]);
			const day = Number(dateMatch[3]);
			const { hour, minute } = parseClock(time) ?? { hour: 0, minute: 0 };
			return dateToIsoStr(year, month, day, hour, minute, timezone, false);
		}
	}

	if (eventDateUnix != null && Number.isFinite(eventDateUnix)) {
		const ms = eventDateUnix > 1e12 ? eventDateUnix : eventDateUnix * 1000;
		const asUtc = new Date(ms);
		if (Number.isNaN(asUtc.getTime())) return undefined;
		// event_date is a local wall-clock unix from the CMS; format in the city zone.
		const parts = new Intl.DateTimeFormat(`en-CA`, {
			timeZone: timezone,
			year: `numeric`,
			month: `2-digit`,
			day: `2-digit`,
			hour: `2-digit`,
			minute: `2-digit`,
			hourCycle: `h23`,
		}).formatToParts(asUtc);
		const pick = (type: Intl.DateTimeFormatPartTypes) =>
			Number(parts.find((part) => part.type === type)?.value);
		const year = pick(`year`);
		const month = pick(`month`);
		const day = pick(`day`);
		const hour = pick(`hour`);
		const minute = pick(`minute`);
		if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;
		return dateToIsoStr(year, month, day, hour, minute, timezone, false);
	}

	return undefined;
}

export function addressLinesFromHtml(html: string | undefined): string[] | undefined {
	if (!html?.trim()) return undefined;
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const root = $(`#root`);
	const lines: string[] = [];

	root.find(`br`).replaceWith(`\n`);
	const text = root.text().replace(/\u00a0/g, ` `);
	for (const raw of text.split(/\n+/)) {
		const line = superTrim(raw);
		if (!line) continue;
		if (/^(website|instagram|email|phone|hp\.?|tel\.?)\b/i.test(line)) continue;
		if (/^https?:\/\//i.test(line)) continue;
		if (/^[\d\s+\-()]+$/.test(line) && line.replace(/\D/g, ``).length >= 8) continue;
		if (!lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) lines.push(line);
	}

	return lines.length ? lines : undefined;
}

export function formatIdr(value: unknown): string | undefined {
	const amount = readNumber(value);
	if (amount == null) return undefined;
	if (amount === 0) return `Free`;
	return `IDR ${new Intl.NumberFormat(`en-US`).format(amount)}`;
}

async function fetchAllEventArticles(): Promise<WniArticle[]> {
	const articles: WniArticle[] = [];
	const seen = new Set<number>();
	let emptyDatedPages = 0;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = new URL(LIST_URL);
		url.searchParams.set(`limit`, String(PAGE_SIZE));
		url.searchParams.set(`page`, String(page));
		url.searchParams.set(`sort`, `soonest`);
		url.searchParams.set(`id_country`, `1`);
		url.searchParams.set(`category`, `1`);

		const body = await customFetch(url.toString(), { returnType: `json` });
		const pageArticles = parseArticlePage(body);
		if (!pageArticles.length) break;

		let added = 0;
		for (const article of pageArticles) {
			if (seen.has(article.id)) continue;
			if (!getStartAt(article)) continue;
			seen.add(article.id);
			articles.push(article);
			added++;
		}

		console.error(`WNI list page ${page}: ${pageArticles.length} rows, ${added} dated kept`);

		if (!added) {
			emptyDatedPages++;
			// `sort=soonest` surfaces dated upcoming rows first; stop once undated tails begin.
			if (emptyDatedPages >= 2) break;
		} else {
			emptyDatedPages = 0;
		}

		const totalPages = readNumber((body as { pagination?: { totalPages?: unknown } })?.pagination?.totalPages);
		if (totalPages != null && page >= totalPages) break;
		if (pageArticles.length < PAGE_SIZE) break;
		await sleep(REQUEST_DELAY_MS);
	}

	return articles;
}

function parseArticlePage(body: unknown): WniArticle[] {
	if (!body || typeof body !== `object`) return [];
	const rows = (body as { articles?: unknown }).articles;
	if (!Array.isArray(rows)) return [];

	const articles: WniArticle[] = [];
	for (const row of rows) {
		const article = parseArticle(row);
		if (article) articles.push(article);
	}
	return articles;
}

function parseArticle(row: unknown): WniArticle | undefined {
	if (!row || typeof row !== `object`) return undefined;
	const record = row as Record<string, unknown>;
	const id = readNumber(record.id);
	const title = readText(record.title);
	const slug = readText(record.slug);
	if (id == null || !title || !slug) return undefined;

	return {
		id,
		title,
		sub_title: readText(record.sub_title),
		slug,
		slug_city: readText(record.slug_city),
		name_city: readText(record.name_city),
		name_country: readText(record.name_country),
		category_name: readText(record.category_name),
		featured_image_url: readText(record.featured_image_url),
		featured_image_16_9_url: readText(record.featured_image_16_9_url),
		featured_image_4_3_url: readText(record.featured_image_4_3_url),
		meta_data: parseMeta(record.meta_data),
	};
}

function parseMeta(value: unknown): WniMeta {
	if (!value || typeof value !== `object`) return {};
	const record = value as Record<string, unknown>;
	return {
		meta_description: readText(record.meta_description),
		start_date: readText(record.start_date),
		end_date: readText(record.end_date),
		start_time: readText(record.start_time),
		end_time: readText(record.end_time),
		event_date: readNumber(record.event_date),
		event_date_end: readNumber(record.event_date_end),
		address: readText(record.address),
		venue: readText(record.venue),
		price: record.price,
		ticket: readText(record.ticket),
		latlong: readText(record.latlong),
		whole_day: readNumber(record.whole_day),
	};
}

async function resolvePoint({
	article,
	address,
}: {
	article: WniArticle;
	address: string[];
}): Promise<{ lat: number; lng: number } | undefined> {
	const fromMeta = parseLatLong(article.meta_data?.latlong);
	if (fromMeta) return fromMeta;

	const apiKey = process.env.GOOGLE_MAPS_API_KEY || ``;
	if (apiKey && address?.length) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey,
				biasAddressLines: GEOCODE_BIAS,
			});
			if (geocoded && hasValidCoordinates({ lat: geocoded.lat, lng: geocoded.lng })) {
				return { lat: geocoded.lat, lng: geocoded.lng };
			}
		} catch (error) {
			console.error(`Geocoding failed for ${article.id}:`, error);
		}
	}

	const city = article.slug_city?.toLowerCase();
	if (city && CITY_COORDS[city]) return CITY_COORDS[city];
	return undefined;
}

function nameHaystack(article: WniArticle): string {
	return [article.title, article.sub_title, article.category_name, article.meta_data?.meta_description]
		.filter(Boolean)
		.join(` `);
}

function timezoneForCity(slugCity: string | undefined): TimeZoneString {
	if (!slugCity) return `Asia/Jakarta`;
	return CITY_TIMEZONE[slugCity.toLowerCase()] ?? `Asia/Jakarta`;
}

function absoluteUploadUrl(path: string | undefined): string | undefined {
	const raw = path?.trim();
	if (!raw) return undefined;
	if (raw.startsWith(`http://`) || raw.startsWith(`https://`)) return raw;
	return makeAbsoluteUrl(raw.startsWith(`/`) ? raw : `/${raw}`, SITE_BASE);
}

function parseClock(time: string | null | undefined): { hour: number; minute: number } | undefined {
	if (!time?.trim()) return undefined;
	const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return undefined;
	return { hour, minute };
}

function getNameFromHtml(html: string): string | undefined {
	const $ = cheerio.load(html);
	return superTrim($(`h1`).first().text()) || undefined;
}

function getDescriptionFromHtml(html: string): string | undefined {
	const $ = cheerio.load(html);
	const content = $(`.content-wrapper`).first().clone();
	if (!content.length) return undefined;
	content.find(`img`).remove();
	content.find(`script, style`).remove();
	return cleanProseHtml(content.html()) || undefined;
}

function getAddressFromHtml(html: string): string[] | undefined {
	const $ = cheerio.load(html);
	const content = $(`.content-wrapper`).first();
	if (!content.length) return undefined;

	const paragraphs = content
		.find(`p`)
		.toArray()
		.map((el) => {
			const clone = $(el).clone();
			clone.find(`br`).replaceWith(`\n`);
			return clone.text().replace(/\u00a0/g, ` `).trim();
		})
		.filter(Boolean);

	for (let index = paragraphs.length - 1; index >= 0; index--) {
		const paragraph = paragraphs[index];
		if (!looksLikeAddressBlock(paragraph)) continue;
		const lines = paragraph
			.split(/\n+/)
			.map((line) => superTrim(line))
			.filter((line): line is string => Boolean(line))
			.filter((line) => !/^(website|instagram|email|phone|hp\.?|tel\.?)\b/i.test(line));
		if (lines.length) return lines;
	}

	return undefined;
}

function looksLikeAddressBlock(text: string): boolean {
	const lower = text.toLowerCase();
	if (/📅|📍/.test(text)) return false;
	if (lower.includes(`jl.`) || lower.includes(`jalan `)) return true;
	if (lower.includes(`phone:`) || lower.includes(`tel:`)) return true;
	// Venue blocks usually stack name + street/city on separate lines with a maps-ish link nearby.
	const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
	if (lines.length < 2) return false;
	if (/\b(bali|jakarta|bandung|surabaya|yogyakarta)\b/i.test(text) && /\d{5}/.test(text)) return true;
	return false;
}

function getPriceFromHtml(html: string): string | undefined {
	const $ = cheerio.load(html);
	const text = $(`.content-wrapper`).text();
	const idr = text.match(/IDR\s*([\d.,]+)/i);
	if (idr?.[1]) {
		const amount = Number(idr[1].replace(/[.,](?=\d{3}\b)/g, ``).replace(`,`, `.`));
		if (Number.isFinite(amount)) return formatIdr(amount);
		return `IDR ${idr[1]}`;
	}
	if (/\b(free entry|free of charge|complimentary)\b/i.test(text)) return `Free`;
	return undefined;
}

function getImageUrlsFromHtml(html: string): string[] {
	const $ = cheerio.load(html);
	const og = $(`meta[property="og:image"]`).attr(`content`);
	const absolute = makeAbsoluteUrl(og, SITE_BASE);
	return absolute ? [absolute] : [];
}

function getContactFromHtml(html: string): string[] {
	const $ = cheerio.load(html);
	return contactsFromSnippet($(`.content-wrapper`).html() ?? ``);
}

function contactsFromSnippet(html: string): string[] {
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const contacts: string[] = [];

	$(`#root a[href]`).each((_, el) => {
		const href = $(el).attr(`href`)?.trim();
		if (!href) return;
		if (href.startsWith(`mailto:`)) {
			contacts.push(href.slice(`mailto:`.length));
			return;
		}
		if (href.startsWith(`tel:`)) {
			contacts.push(href);
			return;
		}
		if (/instagram\.com|wa\.me|whatsapp|http/i.test(href) && href.startsWith(`http`)) {
			contacts.push(href);
		}
	});

	const phoneMatch = $.text().match(/(?:\+|00)?\d[\d\s\-()]{7,}\d/g) ?? [];
	for (const phone of phoneMatch) {
		const digits = phone.replace(/\D/g, ``);
		if (digits.length >= 9) contacts.push(`tel:+${digits.replace(/^0/, `62`)}`);
	}

	return [...new Set(contacts)];
}

function getMetaFromHtml(html: string): WniMeta | undefined {
	const match = html.match(/\\"meta_data\\":(\{.*?\})(?=,\\"status\\")/);
	if (!match?.[1]) return undefined;
	try {
		const json = match[1].replace(/\\"/g, `"`).replace(/\\\\/g, `\\`);
		return parseMeta(JSON.parse(json));
	} catch {
		return undefined;
	}
}

function getCitySlugFromHtml(html: string): string | undefined {
	const canonical = cheerio.load(html)(`link[rel="canonical"]`).attr(`href`);
	const match = canonical?.match(/whatsnewindonesia\.com\/([^/]+)\//i);
	return match?.[1];
}

function readText(value: unknown): string | undefined {
	if (typeof value !== `string`) return undefined;
	const text = value.trim();
	return text || undefined;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value === `string` && value.trim() && Number.isFinite(Number(value))) return Number(value);
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
		const { limit } = parseCliArgs(process.argv.slice(2));
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type WniMeta = {
	meta_description?: string;
	start_date?: string;
	end_date?: string;
	start_time?: string;
	end_time?: string;
	event_date?: number;
	event_date_end?: number;
	address?: string;
	venue?: string;
	price?: unknown;
	ticket?: string;
	latlong?: string;
	whole_day?: number;
};

type WniArticle = {
	id: number;
	title: string;
	sub_title?: string;
	slug: string;
	slug_city?: string;
	name_city?: string;
	name_country?: string;
	category_name?: string;
	featured_image_url?: string;
	featured_image_16_9_url?: string;
	featured_image_4_3_url?: string;
	meta_data?: WniMeta;
};
