/**
 * Scrapes Bali by Anilau (bali.anilau.com) events.
 *
 * Listing: paginated `/en/tags/events` offer cards → detail URLs.
 * Detail: Schema.org Event JSON-LD for core fields, HTML for body/price/tags.
 *
 * Note: balibyanilau.com does not resolve; the live site is bali.anilau.com.
 *
 * Usage:
 *   bun run scripts/scrape-balibyanilau.ts
 *   bun run scripts/scrape-balibyanilau.ts --limit 10
 *   bun run scripts/scrape-balibyanilau.ts <html_file> ...
 */
import * as cheerio from "cheerio";
import type { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	REQUEST_DELAY_MS,
	sleep,
	superTrim,
} from "./common.ts";
import { matchesBlackListWords, matchesWhiteListWords } from "../src/whitelistWords.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://bali.anilau.com`;
const EVENTS_LISTING = `${SITE_BASE}/en/tags/events`;
const SOURCE = `balibyanilau` as const;
const TIMEZONE = `Asia/Makassar` as const;
const MAX_PAGES = 30;
const UPCOMING_GRACE_MS = 6 * 60 * 60 * 1000;
const SITE_CONTACT = /anilau\.com|balitopmail@/i;
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
			`Fetching Bali by Anilau events from ${EVENTS_LISTING}${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let cards: ListingCard[];
		try {
			cards = await collectEventCards();
		} catch (error) {
			console.error(`Failed to collect Anilau event URLs:`, error);
			return [];
		}

		const candidates = cards.filter((card) => !card.name || passesNameFilter(card.name));
		console.error(
			`Found ${cards.length} listing cards (${candidates.length} whitelist candidates). Fetching details...`,
		);

		const events: ScrapedEvent[] = [];
		const seen = new Set<string>();

		for (const card of candidates) {
			if (resolvedLimit != null && events.length >= resolvedLimit) break;
			try {
				await sleep(REQUEST_DELAY_MS);
				const html = await customFetch(card.url, { returnType: `text` });
				const event = await mapEventHtml({ html, url: card.url });
				if (!event) continue;
				if (seen.has(event.sourceUrl)) continue;
				seen.add(event.sourceUrl);
				events.push(event);
			} catch (error) {
				console.error(`Failed to process ${card.url}:`, error);
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
				if (isListingHtml(html)) {
					const urls = collectEventUrlsFromHtml(html);
					for (const url of urls) {
						try {
							await sleep(REQUEST_DELAY_MS);
							const detailHtml = await customFetch(url, { returnType: `text` });
							const event = await mapEventHtml({ html: detailHtml, url });
							if (event) events.push(event);
						} catch (error) {
							console.error(`Failed to process ${url} from listing ${filePath}:`, error);
						}
					}
					continue;
				}

				const url = inferDetailUrl(html) ?? `file://${filePath}`;
				const event = await mapEventHtml({ html, url });
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapEventHtml({ html, url });
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

export async function mapEventHtml({
	html,
	url,
}: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const name = getName(html);
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl(html) ?? url;
	if (!name || !startAt) {
		console.error(`Skipping ${sourceUrl}: missing name or startAt`);
		return undefined;
	}

	if (!passesNameFilter(name)) {
		console.error(`Skipping ${name} (title failed whitelist/blacklist filter)`);
		return undefined;
	}

	const endAt = getEndAt(html);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	const address = getAddress(html);
	let latitude: number | null = null;
	let longitude: number | null = null;
	let timezone: string | null = TIMEZONE;

	if (address?.length) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: geocodeAddressLines(address),
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

export async function collectEventCards(): Promise<ListingCard[]> {
	const cards: ListingCard[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= MAX_PAGES; page++) {
		const pageUrl = page === 1 ? EVENTS_LISTING : `${EVENTS_LISTING}?page=${page}`;
		let html: string;
		try {
			html = await customFetch(pageUrl, { returnType: `text` });
		} catch (error) {
			console.error(`Failed to fetch listing page ${pageUrl}:`, error);
			break;
		}

		const pageCards = collectEventCardsFromHtml(html);
		let added = 0;
		for (const card of pageCards) {
			if (seen.has(card.url)) continue;
			seen.add(card.url);
			cards.push(card);
			added++;
		}
		console.error(`  page ${page}: ${pageCards.length} cards (${added} new)`);
		if (!pageCards?.length) break;
		if (!hasNextListingPage(html, page)) break;
		await sleep(REQUEST_DELAY_MS);
	}

	return cards;
}

export function collectEventUrlsFromHtml(html: string): string[] {
	return collectEventCardsFromHtml(html).map((card) => card.url);
}

export function collectEventCardsFromHtml(html: string): ListingCard[] {
	const $ = cheerio.load(html);
	const cards: ListingCard[] = [];
	const seen = new Set<string>();

	$(`.offer-item`).each((_, item) => {
		const link = $(item).find(`h3 a[href]`).first();
		const href = link.attr(`href`);
		const absolute = makeAbsoluteUrl(href, SITE_BASE);
		if (!absolute?.startsWith(`${SITE_BASE}/en/ads/`)) return;
		if (isCategoryUrl(absolute)) return;
		if (seen.has(absolute)) return;
		seen.add(absolute);
		cards.push({
			url: absolute,
			name: superTrim(link.text()) || undefined,
		});
	});

	if (cards?.length) return cards;

	// Fallback when offer-item wrappers are missing.
	$(`a.text-ellipsis[href*="/ads/"]`).each((_, el) => {
		const href = $(el).attr(`href`);
		const absolute = makeAbsoluteUrl(href, SITE_BASE);
		if (!absolute?.startsWith(`${SITE_BASE}/en/ads/`)) return;
		if (isCategoryUrl(absolute)) return;
		if (seen.has(absolute)) return;
		seen.add(absolute);
		cards.push({
			url: absolute,
			name: superTrim($(el).text()) || undefined,
		});
	});

	return cards;
}

function passesNameFilter(name: string): boolean {
	if (matchesBlackListWords(name)) return false;
	return matchesWhiteListWords(name);
}

export function getName(html: string): string | undefined {
	const event = getEventLd(html);
	const fromLd = decodeText(event?.name);
	if (fromLd) return fromLd;

	const $ = cheerio.load(html);
	return superTrim($(`h1`).first().text()) || undefined;
}

export function getStartAt(html: string): string | undefined {
	return normalizeIso(getEventLd(html)?.startDate);
}

export function getEndAt(html: string): string | undefined {
	const startAt = getStartAt(html);
	const endAt = normalizeIso(getEventLd(html)?.endDate);
	if (!endAt) return undefined;
	if (startAt && Date.parse(endAt) <= Date.parse(startAt)) return undefined;
	return endAt;
}

export function getAddress(html: string): string[] {
	const event = getEventLd(html);
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

	const location = event?.location;
	if (location && typeof location === `object`) {
		push(decodeText(location.name));
		const address = location.address;
		if (typeof address === `string`) {
			for (const part of address.split(/,|;/)) push(part);
		} else if (address && typeof address === `object`) {
			push(decodeText(address.streetAddress));
			const cityLine = [decodeText(address.addressLocality), decodeText(address.postalCode)]
				.filter(Boolean)
				.join(` `);
			push(cityLine);
			push(decodeText(address.addressRegion));
			const country = decodeText(address.addressCountry);
			if (country && !/^indonesia$/i.test(country)) push(country);
		}
	}

	if (lines?.length) return lines;

	const $ = cheerio.load(html);
	const venueField = $(`.service-page__facts dt`)
		.filter((_, el) => /venue/i.test($(el).text()))
		.first()
		.next(`dd`);
	if (venueField.length) {
		const htmlVenue = venueField.html() ?? ``;
		for (const part of htmlVenue.split(/<br\s*\/?>/i)) {
			push(cheerio.load(`<div>${part}</div>`)(`div`).text());
		}
	}

	if (!lines?.length) lines.push(`Bali`);
	return lines;
}

export function getPrice(html: string): string | undefined {
	const event = getEventLd(html);
	const offers = normalizeOffers(event?.offers);
	for (const offer of offers) {
		if (offer.price === 0 || offer.price === `0`) return `Free`;
		const formatted = formatMoney({
			amount: offer.price,
			currency: offer.priceCurrency,
		});
		if (formatted) return formatted;
	}

	const $ = cheerio.load(html);
	const admission = factValue($, `Admission`);
	if (admission && /free/i.test(admission)) return `Free`;
	if (admission && /donation/i.test(admission)) return `Donation`;

	const bodyText = [
		$(`.post-text-container`).text(),
		$(`.service-page__teaser`).text(),
		event?.description ?? ``,
	].join(` `);
	const fromBody = priceFromBodyText(bodyText);
	if (fromBody) return fromBody;

	if (admission && /paid/i.test(admission)) return `Paid`;
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const container = $(`.post-text-container`).first();
	if (container.length) {
		const clone = container.clone();
		clone.find(`script, style`).remove();
		const inner = clone.html()?.trim();
		if (inner) {
			const asHtml = /<[a-z][\s\S]*>/i.test(inner) ? inner : `<p>${escapeHtml(inner)}</p>`;
			const cleaned = cleanProseHtml(asHtml);
			if (cleaned?.trim()) return cleaned;
		}
	}

	const teaser = superTrim($(`.service-page__teaser`).first().text());
	const ldDescription = decodeText(getEventLd(html)?.description);
	const fallback = teaser || ldDescription;
	if (!fallback) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(fallback)}</p>`) || undefined;
}

export function getImageUrls(html: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const url = preferFullImageUrl(raw);
		if (!url?.startsWith(`http`)) return;
		if (seen.has(url)) return;
		seen.add(url);
		urls.push(url);
	};

	const $ = cheerio.load(html);
	add($(`.public-photo-gallery__cover img`).first().attr(`src`));
	add($(`.public-photo-gallery__cover img`).first().attr(`data-src`));

	const event = getEventLd(html);
	const images = event?.image;
	if (typeof images === `string`) add(images);
	else if (Array.isArray(images)) {
		for (const image of images) {
			if (typeof image === `string`) add(image);
			else if (image && typeof image === `object`) add(image.url);
		}
	}

	return urls;
}

export function getHost(html: string): string | undefined {
	const organizer = getEventLd(html)?.organizer;
	if (typeof organizer === `string`) return decodeText(organizer) || undefined;
	if (organizer && typeof organizer === `object`) {
		return decodeText(organizer.name) || undefined;
	}

	const $ = cheerio.load(html);
	return decodeText(factValue($, `Organizer`)) || undefined;
}

export function getHostLink(html: string): string | undefined {
	const organizer = getEventLd(html)?.organizer;
	if (organizer && typeof organizer === `object`) {
		const url = superTrim(organizer.url);
		if (url?.startsWith(`http`) && !SITE_CONTACT.test(url)) return url;
	}

	const $ = cheerio.load(html);
	const href = $(`.service-page__facts dt`)
		.filter((_, el) => /organizer/i.test($(el).text()))
		.first()
		.next(`dd`)
		.find(`a[href]`)
		.first()
		.attr(`href`);
	if (href?.startsWith(`http`) && !SITE_CONTACT.test(href)) return href;
	return undefined;
}

export function getContact(html: string): string[] {
	const contacts: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const value = superTrim(raw);
		if (!value) return;
		if (SITE_CONTACT.test(value)) return;
		if (!(value.startsWith(`http`) || value.startsWith(`mailto:`) || value.startsWith(`tel:`))) {
			return;
		}
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		contacts.push(value);
	};

	const event = getEventLd(html);
	for (const offer of normalizeOffers(event?.offers)) add(offer.url);
	add(getHostLink(html));

	const $ = cheerio.load(html);
	$(`.service-page__event-details a.anilau-btn-primary[href], .service-page__facts a[href]`).each(
		(_, el) => {
			add($(el).attr(`href`));
		},
	);

	return contacts;
}

export function getTags(html: string): string[] {
	const $ = cheerio.load(html);
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined) => {
		const text = superTrim(raw);
		if (!text) return;
		const key = text.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		tags.push(text);
	};

	$(`a.advertisement-badge--tag, a[href*="/tags/"]`).each((_, el) => {
		add($(el).text());
	});

	if (!tags?.length) add(`events`);
	return tags;
}

export function getSourceUrl(html: string): string | undefined {
	const url = superTrim(getEventLd(html)?.url);
	if (url?.startsWith(`http`)) return url;
	const $ = cheerio.load(html);
	const canonical = $(`link[rel="canonical"]`).attr(`href`);
	return makeAbsoluteUrl(canonical, SITE_BASE);
}

function getEventLd(html: string): SchemaEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const raw = $(el).html()?.trim();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			const event = findSchemaEvent(parsed);
			if (event) return event;
		} catch {
			continue;
		}
	}
	return undefined;
}

function findSchemaEvent(value: unknown): SchemaEvent | undefined {
	if (!value) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findSchemaEvent(item);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value !== `object`) return undefined;
	const record = value as Record<string, unknown>;
	const type = record[`@type`];
	const types = Array.isArray(type) ? type : [type];
	if (types.some((t) => t === `Event`)) return record as SchemaEvent;
	if (record[`@graph`]) return findSchemaEvent(record[`@graph`]);
	return undefined;
}

function normalizeIso(raw: string | undefined): string | undefined {
	const value = superTrim(raw);
	if (!value) return undefined;

	const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnly) {
		return dateToIsoStr(
			Number(dateOnly[1]),
			Number(dateOnly[2]) - 1,
			Number(dateOnly[3]),
			0,
			0,
			TIMEZONE,
			true,
		);
	}

	const ms = Date.parse(value);
	if (Number.isNaN(ms)) return undefined;
	return value;
}

function normalizeOffers(offers: SchemaEvent[`offers`]): SchemaOffer[] {
	if (!offers) return [];
	if (Array.isArray(offers)) {
		return offers.filter((offer): offer is SchemaOffer => !!offer && typeof offer === `object`);
	}
	if (typeof offers === `object`) return [offers];
	return [];
}

function formatMoney({
	amount,
	currency,
}: {
	amount: string | number | undefined;
	currency: string | undefined;
}): string | undefined {
	if (amount == null || amount === ``) return undefined;
	const numeric = typeof amount === `number` ? amount : Number(String(amount).replace(/,/g, ``));
	if (Number.isNaN(numeric)) {
		const text = superTrim(String(amount));
		return text || undefined;
	}
	if (numeric === 0) return `Free`;

	const code = (currency || `IDR`).toUpperCase();
	const formatted = Math.round(numeric).toLocaleString(`en-US`);
	if (code === `IDR`) return `IDR ${formatted}`;
	if (code === `USD`) return `$${formatted}`;
	return `${code} ${formatted}`;
}

function preferFullImageUrl(raw: string | undefined): string | undefined {
	const url = superTrim(raw);
	if (!url) return undefined;
	return url.replace(/\/thumb_/i, `/`);
}

function priceFromBodyText(bodyText: string): string | undefined {
	const idr = bodyText.match(/\bIDR\s*([\d.,]+)\s*(k)?/i);
	if (idr) {
		const raw = idr[1].replace(/,/g, ``);
		const amount = Number(raw) * (idr[2] ? 1000 : 1);
		if (!Number.isNaN(amount)) return formatMoney({ amount, currency: `IDR` });
	}

	const usd = bodyText.match(/(?:US\s*\$|USD\s*|\$)\s*([\d.,]+)/i);
	if (usd) {
		const amount = Number(usd[1].replace(/,/g, ``));
		if (!Number.isNaN(amount)) return formatMoney({ amount, currency: `USD` });
	}

	return undefined;
}

function geocodeAddressLines(address: string[]): string[] {
	const joined = address.join(` `).toLowerCase();
	const lines = [...address];
	if (!/\bbali\b/.test(joined)) lines.push(`Bali`);
	if (!/\bindonesia\b/.test(joined)) lines.push(`Indonesia`);
	return lines;
}

function isUpcoming({ startAt, endAt }: { startAt: string; endAt?: string }): boolean {
	const now = Date.now() - UPCOMING_GRACE_MS;
	const endMs = endAt ? Date.parse(endAt) : NaN;
	if (!Number.isNaN(endMs)) return endMs >= now;
	const startMs = Date.parse(startAt);
	if (Number.isNaN(startMs)) return false;
	return startMs >= now;
}

function isListingHtml(html: string): boolean {
	return html.includes(`offer-item`) && html.includes(`/tags/events`);
}

function hasNextListingPage(html: string, page: number): boolean {
	const $ = cheerio.load(html);
	const nextHref = $(`a.public-pagination__button--next`).attr(`href`);
	if (nextHref) return true;
	return $(`a.public-pagination__number[href*="page=${page + 1}"]`).length > 0;
}

function isCategoryUrl(url: string): boolean {
	try {
		const path = new URL(url).pathname.replace(/\/+$/, ``);
		const parts = path.split(`/`).filter(Boolean);
		// /en/ads/{section} or /en/ads/{section}/{subsection} without a slug leaf that looks like an ad.
		if (parts.length <= 3) return true;
		if (parts.length === 4) {
			// Ambiguous: could be subsection listing or a top-level section ad.
			// Treat known subsection slugs as categories when the path has no further leaf uniqueness —
			// offer-item links are preferred; this only filters nav noise.
			const leaf = parts[3];
			if (/^(nightlife-events-tickets|meetups-clubs-communities|excursions-tours-guides|sports-outdoor-activities|fitness-yoga-mental-health)$/i.test(leaf)) {
				return true;
			}
		}
		return false;
	} catch {
		return true;
	}
}

function inferDetailUrl(html: string): string | undefined {
	return getSourceUrl(html);
}

function factValue($: cheerio.CheerioAPI, label: string): string | undefined {
	const dd = $(`.service-page__facts dt`)
		.filter((_, el) => new RegExp(`^\\s*${label}\\s*$`, `i`).test($(el).text()))
		.first()
		.next(`dd`);
	if (!dd.length) return undefined;
	return superTrim(dd.text()) || undefined;
}

function decodeText(value: string | undefined): string | undefined {
	const text = superTrim(value);
	if (!text) return undefined;
	return text
		.replaceAll(`&amp;`, `&`)
		.replaceAll(`&lt;`, `<`)
		.replaceAll(`&gt;`, `>`)
		.replaceAll(`&quot;`, `"`)
		.replaceAll(`&#39;`, `'`)
		.replaceAll(`&apos;`, `'`);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function parseCliArgs(): { limit?: number; files: string[] } {
	const args = process.argv.slice(2);
	let limit: number | undefined;
	const files: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === `--limit`) {
			const value = Number(args[i + 1]);
			if (!Number.isNaN(value) && value > 0) limit = value;
			i++;
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			const value = Number(arg.slice(`--limit=`.length));
			if (!Number.isNaN(value) && value > 0) limit = value;
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

if (import.meta.main) {
	try {
		const { files, limit } = parseCliArgs();
		const scraper = new WebsiteScraper();
		const events = files?.length
			? await scraper.scrapeHtmlFiles(files)
			: await scraper.scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type ListingCard = {
	url: string;
	name?: string;
};

type SchemaOffer = {
	url?: string;
	price?: string | number;
	priceCurrency?: string;
};

type SchemaEvent = {
	name?: string;
	url?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	image?: string | Array<string | { url?: string }>;
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
	};
	organizer?: string | { name?: string; url?: string };
	offers?: SchemaOffer | SchemaOffer[];
};
