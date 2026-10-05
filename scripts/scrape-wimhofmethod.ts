/**
 * Scrapes every upcoming activity on activities.wimhofmethod.com.
 *
 * The listing is a Vue search (`/activities-search`) that pages 9 at a time.
 * `lat`/`lng` of `0.001` is the page's own "no location" sentinel, so the
 * distance filter does not hide activities. Each result is one dated occurrence.
 * The detail page HTML (JSON-LD Event) has the year and timezone the listing omits.
 *
 * Usage:
 *   bun run scripts/scrape-wimhofmethod.ts
 */
import * as cheerio from "cheerio";
import { generateSlug } from "../src/lib/common.ts";
import type { ScrapedEvent } from "../src/lib/types.ts";
import { WebsiteScraperInterface, cleanProseHtml, customFetch } from "./common.ts";

const SITE_BASE = `https://activities.wimhofmethod.com`;
const SEARCH_URL = `${SITE_BASE}/activities-search`;
const PAGE_SIZE = 9;
const MAX_PAGES = 200;
const DETAIL_CONCURRENCY = 4;
const SOURCE = `wimhofmethod` as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		console.error(`Fetching Wim Hof Method activities...`);
		const listings = await fetchAllActivities();
		console.error(`Found ${listings.length} activities. Loading detail pages...`);
		const events = await collectActivityPages({ listings });
		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		const dateId = Number(url.match(/\/(\d+)\/?$/)?.[1]);
		const slug = url.match(/\/activities\/([^/]+)/)?.[1] ?? ``;
		return mapWhmActivity({
			html,
			url,
			listing: {
				workshopSlug: slug,
				workshopDateId: Number.isFinite(dateId) ? dateId : 0,
				title: getName(html),
			},
		});
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

/**
 * Loads each activity page on its own. A failure on one activity does not stop the rest.
 */
export async function collectActivityPages(args: {
	listings: WhmActivity[];
	loadHtml?: (url: string) => Promise<string>;
}): Promise<ScrapedEvent[]> {
	const { listings, loadHtml = (url) => customFetch(url, { returnType: `text` }) } = args;
	const mapped: MappedActivity[] = [];
	let index = 0;
	let done = 0;
	let failed = 0;

	async function worker() {
		while (index < listings.length) {
			const current = index;
			index += 1;
			const listing = listings[current];
			const url = activityUrl(listing);
			if (!url) {
				failed += 1;
				done += 1;
				console.error(`Skipping activity ${listing?.workshopDateId}: missing slug.`);
				continue;
			}

			try {
				const html = await loadHtml(url);
				const event = mapWhmActivity({ html, listing, url });
				if (!event) {
					failed += 1;
					console.error(`Skipping ${url}: missing name or start.`);
				} else {
					mapped[current] = { event, city: listing.location?.city?.trim() || undefined };
				}
			} catch (error) {
				failed += 1;
				console.error(`Failed to process ${url}:`, error);
			}

			done += 1;
			if (done % 25 === 0 || done === listings.length) {
				console.error(`  details ${done}/${listings.length}`);
			}
		}
	}

	const workers = Math.min(DETAIL_CONCURRENCY, listings.length);
	if (workers > 0) {
		await Promise.all(Array.from({ length: workers }, () => worker()));
	}

	if (failed > 0) {
		console.error(`${failed} activities could not be mapped.`);
	}

	return uniqueActivities(mapped.filter((item) => item?.event));
}

export function mapWhmActivity(args: { html: string; listing: WhmActivity; url: string }): ScrapedEvent | undefined {
	const { html, listing, url } = args;
	const name = getName(html) || listing.title?.trim() || undefined;
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl(html) || url;
	if (!name || !startAt || !sourceUrl) return undefined;

	const imageUrls = uniqueStrings([listingCover(listing), ...getImageUrls(html)]);
	const tags = uniqueStrings([...getTags(html), ...listingTags(listing)]);

	return {
		name,
		startAt,
		endAt: getEndAt(html),
		timezone: resolveTimezone({ html, country: listing.location?.country }),
		address: withAddressFallback({ html, listing }),
		price: getPrice(html),
		priceIsHtml: getPriceIsHtml(html),
		description: getDescription(html),
		imageUrls,
		host: getHost(html) || listing.trainerName?.trim() || undefined,
		hostLink: getHostLink(html),
		contact: getContact(html),
		latitude: getLatitude(html),
		longitude: getLongitude(html),
		tags,
		sourceUrl,
		source: getSource(html),
	};
}

/**
 * Co-hosts and ticket tiers list the same activity several times. Same title and start plus the same venue address
 * or the same trainer (one person can't run two sessions at once) collapse to one.
 * A city-only address ("Budapest, Hungary") is not proof of the same venue.
 * Stored slugs are name + UTC day, so remaining same-day namesakes get the city, then start time, then host appended.
 */
export function uniqueActivities(items: MappedActivity[]): ScrapedEvent[] {
	const seen = new Set<string>();
	const unique = items.filter(({ event }) => {
		const base = `${event.name}|${event.startAt}`;
		const keys = [
			event.address.length > 2 ? `${base}|venue|${event.address.join(`, `)}` : undefined,
			event.host ? `${base}|host|${event.host}` : undefined,
		]
			.filter((key): key is string => Boolean(key))
			.map((key) => key.toLowerCase());
		if (keys.some((key) => seen.has(key))) return false;
		keys.forEach((key) => seen.add(key));
		return true;
	});

	const withCity = suffixSlugCollisions({ events: unique.map((item) => item.event), getSuffix: (index) => unique[index].city });
	const withTime = suffixSlugCollisions({ events: withCity, getSuffix: (index) => withCity[index].startAt.slice(11, 16) });
	return suffixSlugCollisions({ events: withTime, getSuffix: (index) => withTime[index].host ?? undefined });
}

function suffixSlugCollisions(args: { events: ScrapedEvent[]; getSuffix: (index: number) => string | undefined }): ScrapedEvent[] {
	const { events, getSuffix } = args;
	const slugs = events.map(slugOf);
	return events.map((event, index) => {
		if (slugs.indexOf(slugs[index]) === slugs.lastIndexOf(slugs[index])) return event;
		const suffix = getSuffix(index)?.trim();
		if (!suffix || event.name.toLowerCase().includes(suffix.toLowerCase())) return event;
		return { ...event, name: `${event.name} · ${suffix}` };
	});
}

function slugOf(event: ScrapedEvent): string {
	return generateSlug({
		name: event.name,
		startAt: new Date(event.startAt),
		endAt: event.endAt ? new Date(event.endAt) : undefined,
	});
}

export function whmDateToIso(raw: string | undefined): string | undefined {
	if (!raw?.trim()) return undefined;
	const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(.+?)(\d{2}):(\d{2})$/);
	if (!match) return undefined;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[5]);
	const minute = Number(match[6]);
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;

	const offset = offsetForZone(match[4]);
	if (!offset) {
		console.error(`Unknown Wim Hof timezone token "${match[4]}" in ${raw}`);
		return undefined;
	}

	const pad = (value: number) => String(value).padStart(2, `0`);
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offset}`;
}

function getName(html: string): string | undefined {
	return textValue(readEvent(html)?.name);
}

function getStartAt(html: string): string | undefined {
	return whmDateToIso(readEvent(html)?.startDate);
}

function getEndAt(html: string): string | undefined {
	return whmDateToIso(readEvent(html)?.endDate);
}

function getTimezone(html: string): string | undefined {
	const zone = zoneToken(readEvent(html)?.startDate);
	if (!zone) return undefined;
	return ZONE_IANA[zone];
}

function resolveTimezone(args: { html: string; country: string | null | undefined }): string | undefined {
	const { html, country } = args;
	const fromCountry = countryTimezone(country);
	const fromZone = getTimezone(html);
	if (country && MULTI_ZONE_COUNTRIES.has(country)) return fromZone || fromCountry;
	return fromCountry || fromZone;
}

function zoneToken(raw: string | undefined): string | undefined {
	return raw?.trim().match(/^(\d{4})-(\d{2})-(\d{2})(.+?)(\d{2}):(\d{2})$/)?.[4];
}

function getAddress(html: string): string[] {
	const event = readEvent(html);
	if (isOnline(event)) return [`Online`];

	const place = event?.location;
	const raw = textValue(place?.name) || textValue(place?.address?.addressLocality);
	if (!raw) return [];
	return raw
		.split(`,`)
		.map((part) => part.trim())
		.filter(Boolean);
}

function getPrice(html: string): string | undefined {
	const offer = readEvent(html)?.offers;
	const amount = Number(offer?.price);
	if (!Number.isFinite(amount)) return undefined;
	if (amount === 0) return `Kostenlos`;
	return formatMoney({ amount, currency: offer?.priceCurrency });
}

function getPriceIsHtml(html: string): boolean {
	void html;
	return false;
}

function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const inner = $(`.cms-editor`).first().html()?.trim();
	if (inner) {
		const cleaned = cleanProseHtml(inner);
		if (cleaned) return cleaned;
	}

	const text = readEvent(html)?.description?.trim();
	if (!text) return undefined;
	return cleanProseHtml(`<p>${escapeHtml(decodeHtml(text))}</p>`) || undefined;
}

function getImageUrls(html: string): string[] {
	const image = readEvent(html)?.image;
	const candidates = Array.isArray(image) ? image : [image];
	return uniqueStrings(candidates.filter((url): url is string => typeof url === `string` && isUsefulImage(url)));
}

function getHost(html: string): string | undefined {
	return textValue(readEvent(html)?.performer?.name);
}

function getHostLink(html: string): string | undefined {
	void html;
	return undefined;
}

function getContact(html: string): string[] {
	const dateId = getSourceUrl(html)?.match(/\/(\d+)$/)?.[1];
	if (!dateId) return [];
	if (!html.includes(`productable_id=${dateId}`)) return [];
	return [`${SITE_BASE}/checkout?productable_type=App%5CModels%5CWorkshopDate&productable_id=${dateId}&quantity=1`];
}

function getLatitude(html: string): number | null {
	void html;
	return null;
}

function getLongitude(html: string): number | null {
	void html;
	return null;
}

function getTags(html: string): string[] {
	const $ = cheerio.load(html);
	let language: string | undefined;
	$(`div`).each((_, el) => {
		if (language) return;
		if ($(el).text().trim() !== `Language`) return;
		const value = $(el).next(`div`).text().replace(/\s+/g, ` `).trim();
		if (!value || value.length > 40) return;
		language = value;
	});
	return language ? [language] : [];
}

function getSourceUrl(html: string): string | undefined {
	const $ = cheerio.load(html);
	const og = $(`meta[property="og:url"]`).attr(`content`)?.trim();
	if (og?.startsWith(`http`)) return og;
	const canonical = $(`link[rel="canonical"]`).attr(`href`)?.trim();
	if (canonical?.startsWith(`http`)) return canonical;
	return undefined;
}

function getSource(html: string): ScrapedEvent[`source`] {
	void html;
	return SOURCE;
}

async function fetchAllActivities(): Promise<WhmActivity[]> {
	const activities: WhmActivity[] = [];
	const seen = new Set<number>();
	let page = 1;
	let lastPage = 1;
	let total = 0;

	while (page <= lastPage && page <= MAX_PAGES) {
		const url = new URL(SEARCH_URL);
		url.searchParams.set(`perPage`, String(PAGE_SIZE));
		url.searchParams.set(`page`, String(page));
		url.searchParams.set(`lat`, `0.001`);
		url.searchParams.set(`lng`, `0.001`);
		url.searchParams.set(`cat`, `0`);
		url.searchParams.set(`activityPreviewId`, `0`);
		url.searchParams.set(`cty`, `0`);
		url.searchParams.set(`lang`, `0`);
		url.searchParams.set(`dura`, `0`);
		url.searchParams.set(`range`, `100`);

		const body = (await customFetch(url.toString(), {
			returnType: `json`,
			headers: {
				Accept: `application/json`,
				"X-Requested-With": `XMLHttpRequest`,
			},
		})) as WhmSearchResponse;

		const pagination = body?.pagination;
		const rows = pagination?.data;
		if (!Array.isArray(rows)) {
			throw new Error(`Wim Hof activities search is missing pagination.data on page ${page}`);
		}
		if (!rows.length) break;

		lastPage = Number(pagination.last_page) || page;
		total = Number(pagination.total) || total;
		let added = 0;
		for (const row of rows) {
			if (typeof row?.workshopDateId !== `number` || !row.workshopSlug?.trim()) {
				console.error(`Skipping search row without slug or date id: ${row?.title ?? `unknown`}`);
				continue;
			}
			if (seen.has(row.workshopDateId)) continue;
			seen.add(row.workshopDateId);
			activities.push(row);
			added += 1;
		}

		console.error(`  page ${page}/${lastPage} — ${activities.length} activities so far`);
		if (!added) break;
		if (activities.length >= total && total > 0) break;
		page += 1;
	}

	if (total > 0 && activities.length < total) {
		console.error(`Wim Hof search returned ${activities.length} activities, expected ${total}`);
	}

	return activities;
}

function withAddressFallback(args: { html: string; listing: WhmActivity }): string[] {
	const fromHtml = getAddress(args.html);
	if (fromHtml.length) return fromHtml;
	const city = args.listing.location?.city?.trim();
	const country = args.listing.location?.country?.trim();
	return [city, country].filter((part): part is string => Boolean(part));
}

function listingCover(listing: WhmActivity): string | undefined {
	if (listing.isDefaultHeaderBackground) return undefined;
	const url = listing.headerBackgroundURL?.trim();
	if (!url || !isUsefulImage(url)) return undefined;
	return url;
}

function listingTags(listing: WhmActivity): string[] {
	const tags: string[] = [];
	for (const category of listing.categories ?? []) {
		const title = category?.title?.trim();
		if (title) tags.push(title);
	}
	const language = listing.language?.trim();
	if (language) tags.push(language);
	return tags;
}

function activityUrl(listing: WhmActivity | undefined): string | undefined {
	const slug = listing?.workshopSlug?.trim();
	if (!slug || typeof listing?.workshopDateId !== `number`) return undefined;
	return `${SITE_BASE}/activities/${slug}/${listing.workshopDateId}`;
}

let lastHtml: string | undefined;
let lastEvent: WhmJsonLdEvent | undefined;

function readEvent(html: string): WhmJsonLdEvent | undefined {
	if (html === lastHtml) return lastEvent;
	lastHtml = html;
	lastEvent = readEventUncached(html);
	return lastEvent;
}

function readEventUncached(html: string): WhmJsonLdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).text();
		if (!text.includes(`Event`)) continue;
		try {
			// Descriptions sometimes contain raw tabs/newlines, which JSON.parse rejects inside strings.
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as WhmJsonLdEvent | WhmJsonLdEvent[];
			const event = (Array.isArray(parsed) ? parsed : [parsed]).find((node) => node?.[`@type`] === `Event`);
			if (event) return event;
		} catch (error) {
			console.error(`Activity JSON-LD is not valid JSON:`, error);
		}
	}
	return undefined;
}

function isOnline(event: WhmJsonLdEvent | undefined): boolean {
	return event?.eventAttendanceMode?.includes(`Online`) ?? false;
}

function isUsefulImage(url: string): boolean {
	const lower = url.toLowerCase();
	if (!lower.startsWith(`https://`) && !lower.startsWith(`http://`)) return false;
	if (lower.includes(`logo.svg`)) return false;
	if (lower.includes(`/placeholders/`)) return false;
	if (lower.includes(`img_activities-min`)) return false;
	if (lower.includes(`activity_background`)) return false;
	return true;
}

function offsetForZone(zone: string): string | undefined {
	if (/^[+-]\d{2}$/.test(zone)) return `${zone}:00`;
	if (/^[+-]\d{4}$/.test(zone)) return `${zone.slice(0, 3)}:${zone.slice(3)}`;
	return ZONE_OFFSETS[zone];
}

function countryTimezone(country: string | null | undefined): string | undefined {
	if (!country) return undefined;
	return COUNTRY_TIMEZONES[country];
}

function formatAmount(args: { amount: number; currency: string | undefined }): string {
	const { amount, currency } = args;
	if (Number.isInteger(amount)) return String(amount);
	const fixed = amount.toFixed(2);
	if (!currency || currency === `EUR`) return fixed.replace(`.`, `,`);
	return fixed;
}

function formatMoney(args: { amount: number; currency: string | undefined }): string {
	const { amount, currency } = args;
	const formatted = formatAmount({ amount, currency });
	if (currency === `GBP`) return `£${formatted}`;
	if (currency === `USD`) return `$${formatted}`;
	if (currency === `AUD`) return `A$${formatted}`;
	if (currency === `CAD`) return `C$${formatted}`;
	if (currency && currency !== `EUR`) return `${formatted} ${currency}`;
	return `${formatted}€`;
}

function uniqueStrings(values: (string | undefined | null)[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

/** JSON-LD strings are HTML-entity encoded (`D&#039;acunto`, `YOGA&amp;CO`). */
function textValue(value: string | undefined | null): string | undefined {
	if (typeof value !== `string`) return undefined;
	return decodeHtml(value).trim() || undefined;
}

function decodeHtml(value: string): string {
	return cheerio.load(`<textarea>${value}</textarea>`)(`textarea`).text();
}

function escapeHtml(text: string): string {
	return text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`);
}

const ZONE_OFFSETS: Record<string, string> = {
	GMT: `+00:00`,
	UTC: `+00:00`,
	WET: `+00:00`,
	WEST: `+01:00`,
	BST: `+01:00`,
	IST: `+01:00`,
	CET: `+01:00`,
	CEST: `+02:00`,
	EET: `+02:00`,
	EEST: `+03:00`,
	TRT: `+03:00`,
	MSK: `+03:00`,
	GST: `+04:00`,
	ICT: `+07:00`,
	WIB: `+07:00`,
	HKT: `+08:00`,
	SGT: `+08:00`,
	AWST: `+08:00`,
	JST: `+09:00`,
	KST: `+09:00`,
	ACST: `+09:30`,
	AEST: `+10:00`,
	ACDT: `+10:30`,
	AEDT: `+11:00`,
	NZST: `+12:00`,
	NZDT: `+13:00`,
	NDT: `-02:30`,
	NST: `-03:30`,
	AST: `-04:00`,
	EDT: `-04:00`,
	EST: `-05:00`,
	CDT: `-05:00`,
	CST: `-06:00`,
	MDT: `-06:00`,
	MST: `-07:00`,
	PDT: `-07:00`,
	PST: `-08:00`,
	AKDT: `-08:00`,
	AKST: `-09:00`,
	HST: `-10:00`,
};

// Standard-time tokens map to zones without DST, so a token like AEST in January (Brisbane) keeps its offset.
const ZONE_IANA: Record<string, string> = {
	GMT: `Europe/London`,
	UTC: `UTC`,
	WET: `Europe/Lisbon`,
	WEST: `Europe/Lisbon`,
	BST: `Europe/London`,
	IST: `Europe/Dublin`,
	CET: `Europe/Berlin`,
	CEST: `Europe/Berlin`,
	EET: `Europe/Helsinki`,
	EEST: `Europe/Helsinki`,
	TRT: `Europe/Istanbul`,
	JST: `Asia/Tokyo`,
	AWST: `Australia/Perth`,
	ACST: `Australia/Darwin`,
	ACDT: `Australia/Adelaide`,
	AEST: `Australia/Brisbane`,
	AEDT: `Australia/Sydney`,
	NZST: `Pacific/Auckland`,
	NZDT: `Pacific/Auckland`,
	NST: `America/St_Johns`,
	NDT: `America/St_Johns`,
	EST: `America/New_York`,
	EDT: `America/New_York`,
	CST: `America/Chicago`,
	CDT: `America/Chicago`,
	MST: `America/Phoenix`,
	MDT: `America/Denver`,
	PST: `America/Los_Angeles`,
	PDT: `America/Los_Angeles`,
};

const MULTI_ZONE_COUNTRIES = new Set([`United States`, `Canada`, `Australia`]);

const COUNTRY_TIMEZONES: Record<string, string> = {
	Australia: `Australia/Sydney`,
	Austria: `Europe/Vienna`,
	Bahrain: `Asia/Bahrain`,
	Belgium: `Europe/Brussels`,
	Canada: `America/Toronto`,
	Cyprus: `Asia/Nicosia`,
	"Czech Republic": `Europe/Prague`,
	Denmark: `Europe/Copenhagen`,
	Estonia: `Europe/Tallinn`,
	Finland: `Europe/Helsinki`,
	France: `Europe/Paris`,
	Germany: `Europe/Berlin`,
	Greece: `Europe/Athens`,
	Guatemala: `America/Guatemala`,
	Hungary: `Europe/Budapest`,
	Iceland: `Atlantic/Reykjavik`,
	Ireland: `Europe/Dublin`,
	Italy: `Europe/Rome`,
	Japan: `Asia/Tokyo`,
	Latvia: `Europe/Riga`,
	Luxembourg: `Europe/Luxembourg`,
	Malta: `Europe/Malta`,
	Martinique: `America/Martinique`,
	Morocco: `Africa/Casablanca`,
	Netherlands: `Europe/Amsterdam`,
	Norway: `Europe/Oslo`,
	Oman: `Asia/Muscat`,
	Poland: `Europe/Warsaw`,
	Portugal: `Europe/Lisbon`,
	Romania: `Europe/Bucharest`,
	Slovakia: `Europe/Bratislava`,
	Slovenia: `Europe/Ljubljana`,
	Spain: `Europe/Madrid`,
	Sweden: `Europe/Stockholm`,
	Switzerland: `Europe/Zurich`,
	Thailand: `Asia/Bangkok`,
	Turkey: `Europe/Istanbul`,
	"United Kingdom": `Europe/London`,
	"United States": `America/New_York`,
};

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite();
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type MappedActivity = { event: ScrapedEvent; city?: string };

type WhmActivity = {
	title?: string | null;
	headerBackgroundURL?: string | null;
	isDefaultHeaderBackground?: boolean | null;
	location?: { country?: string | null; city?: string | null } | null;
	language?: string | null;
	workshopSlug?: string | null;
	workshopDateId?: number | null;
	categories?: { id?: number; title?: string | null }[] | null;
	trainerName?: string | null;
};

type WhmSearchResponse = {
	pagination?: {
		current_page?: number;
		last_page?: number;
		total?: number;
		data?: WhmActivity[];
	};
};

type WhmJsonLdEvent = {
	"@type"?: string;
	name?: string;
	startDate?: string;
	endDate?: string;
	eventAttendanceMode?: string;
	description?: string;
	image?: string | string[];
	location?: {
		name?: string;
		address?: {
			addressLocality?: string;
			addressCountry?: { name?: string } | string;
		};
	};
	offers?: {
		price?: string | number;
		priceCurrency?: string;
	};
	performer?: {
		name?: string;
	};
};
