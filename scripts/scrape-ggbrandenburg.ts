/**
 * Scrapes ganzheitlich-gesund-brandenburg.de/veranstaltungen listing pages,
 * then each event detail. Prefers Event JSON-LD (name, startDate, images, location)
 * over fragile HTML date headings.
 *
 * Usage:
 *   bun run scripts/scrape-ggbrandenburg.ts
 *   bun run scripts/scrape-ggbrandenburg.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	REQUEST_DELAY_MS,
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const BASE_URL = `https://www.ganzheitlich-gesund-brandenburg.de`;
const START_PATH = `/veranstaltungen/index.php`;
const SOURCE = `ggbrandenburg` as const;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	private readonly requestDelayMs = REQUEST_DELAY_MS;

	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		console.error(`--- Starting GG Brandenburg Event Scraper (Web Mode) ---`);

		const pageUrl = `${BASE_URL}${START_PATH}`;
		console.error(`\n--- Fetching listing: ${pageUrl} ---`);

		let pageHtml: string | undefined;
		try {
			await sleep(this.requestDelayMs);
			pageHtml = await customFetch(pageUrl, { returnType: `text` });
		} catch (error) {
			console.error(`Failed to fetch listing page:`, error);
			return [];
		}
		if (!pageHtml) {
			console.error(`Empty listing page. Stopping.`);
			return [];
		}

		const eventUrls = extractEventUrls(pageHtml);
		if (!eventUrls?.length) {
			console.error(`No events found on listing page.`);
			return [];
		}

		console.error(`Processing ${eventUrls.length} events...`);
		for (const eventUrl of eventUrls) {
			try {
				await sleep(this.requestDelayMs);
				const html = await customFetch(eventUrl, { returnType: `text` });
				if (!html) {
					console.error(`Failed to fetch details for: ${eventUrl}. Skipping event.`);
					continue;
				}

				const event = await mapGgbrandenburgEvent({ html, url: eventUrl });
				if (event) {
					allEvents.push(event);
					console.log(`✓ Processed: ${event.name}`, event);
				} else {
					console.warn(`Failed to get complete details for event: ${eventUrl}`);
				}
			} catch (error) {
				console.error(`Error processing event item "${eventUrl}":`, error);
			}
		}

		console.error(`\n--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		console.error(`--- Starting GG Brandenburg Event Scraper (Local File Mode) ---`);
		const allEvents: ScrapedEvent[] = [];

		for (const filePath of filePaths) {
			console.error(`Processing local HTML file: ${filePath}...`);
			try {
				const htmlContent = await Bun.file(filePath).text();
				const event = await mapGgbrandenburgEvent({ html: htmlContent, url: filePath });
				if (event) {
					allEvents.push(event);
				} else {
					console.error(`Could not extract event data from ${filePath}.`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`Error processing file ${filePath}:`, message);
			}
		}

		console.error(
			`--- Processed ${filePaths.length} files. Total events extracted: ${allEvents.length} ---`,
		);
		return allEvents;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			return await mapGgbrandenburgEvent({ html, url });
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

export async function mapGgbrandenburgEvent(args: {
	html: string;
	url: string;
}): Promise<ScrapedEvent | undefined> {
	const { html, url } = args;
	const name = getName(html);
	const startAt = getStartAt(html);

	if (!name || !startAt) {
		console.warn(`Missing required fields for event at ${url}: name = ${name}, startAt = ${startAt}`);
		return undefined;
	}

	let endAt = getEndAt(html);
	if (endAt && endAt < startAt) {
		console.warn(
			`Event ${name} has endAt(${endAt}) before startAt(${startAt}). Setting endAt to undefined.`,
		);
		endAt = undefined;
	}

	const address = getAddress(html);
	let latitude: number | null = null;
	let longitude: number | null = null;
	let timezone: string | null = DEFAULT_TIMEZONE;

	if (address?.length) {
		try {
			const coordinates = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			latitude = coordinates?.lat ?? null;
			longitude = coordinates?.lng ?? null;
			timezone = coordinates?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${url}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt,
		address,
		price: getPrice(html) ?? null,
		priceIsHtml: false,
		description: getDescription(html) ?? null,
		imageUrls: getImageUrls(html) || [],
		host: getHost(html) ?? null,
		hostLink: getHostLink(html) ?? null,
		sourceUrl: url,
		latitude,
		longitude,
		timezone,
		tags: getTags(html) || [],
		source: SOURCE,
	};
}

export function extractEventUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls = new Set<string>();

	$(`div.row.events-entry-3 a[href*="/veranstaltungen/"]`).each((_index, element) => {
		const permalink = $(element).attr(`href`);
		if (!permalink?.includes(`/veranstaltungen/`)) return;
		if (permalink.includes(`/veranstaltungen/index.php`)) return;
		const fullUrl = permalink.startsWith(`http`) ? permalink : `${BASE_URL}${permalink}`;
		urls.add(fullUrl);
	});

	return [...urls];
}

export function getName(html: string): string | undefined {
	const ldName = textValue(readEvent(html)?.name);
	if (ldName) return ldName;

	const $ = cheerio.load(html);
	return superTrim($(`h1`).first().text()) || undefined;
}

export function getStartAt(html: string): string | undefined {
	return parseLdDate(readEvent(html)?.startDate) ?? parseHeadingStart(html);
}

export function getEndAt(html: string): string | undefined {
	const startAt = getStartAt(html);
	const endAt = parseLdDate(readEvent(html)?.endDate) ?? parseHeadingEnd(html);
	if (!endAt) return undefined;
	if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) return undefined;
	return endAt;
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
	if (location && typeof location === `object`) {
		push(typeof location.name === `string` ? location.name : undefined);
		const address = location.address;
		if (typeof address === `string`) {
			for (const part of address.split(`,`)) push(part);
		} else if (address && typeof address === `object`) {
			push(typeof address.streetAddress === `string` ? address.streetAddress : undefined);
			const localityParts = [
				typeof address.postalCode === `string` ? address.postalCode : undefined,
				typeof address.addressLocality === `string` ? address.addressLocality : undefined,
			].filter(Boolean);
			if (localityParts?.length) push(localityParts.join(` `));
		}
	}

	// Site is Potsdam-centric; some events only list a venue name.
	if (!lines.some((line) => line.toLowerCase().includes(`potsdam`))) {
		push(`Potsdam`);
	}

	return lines;
}

export function getPrice(_html: string): string | undefined {
	return undefined;
}

export function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	let description = ``;

	$(`#content p.tiny_p`).each((_i, el) => {
		const elementHtml = $(el).prop(`outerHTML`)?.trim() ?? ``;
		if (!elementHtml) return;
		// Skip teaser/sidebar cards that also use tiny_p.
		if ($(el).closest(`.tab_link, .events-entry-3`).length) return;
		description += `${elementHtml} `;
	});

	description = resolveEmail(description);
	return cleanProseHtml(description) || undefined;
}

export function getImageUrls(html: string): string[] | undefined {
	const image = readEvent(html)?.image;
	if (typeof image === `string` && image.trim()) return [image.trim()];
	if (Array.isArray(image)) {
		const urls = image.filter((value): value is string => typeof value === `string` && !!value.trim());
		return urls?.length ? urls : undefined;
	}
	return undefined;
}

export function getHost(html: string): string | undefined {
	const $ = cheerio.load(html);

	const organizerHeading = $(`h3`).filter((_i, el) => {
		const text = ($(el).text() || ``).toLowerCase();
		return text.includes(`veranstalter`) && !text.includes(`veranstaltungsort`);
	});
	if (organizerHeading.length > 0) {
		const organizerName = superTrim(organizerHeading.first().nextAll(`h4, h5`).first().text());
		if (organizerName) return organizerName;
	}

	const combinedHeading = $(`h3`).filter((_i, el) => {
		const text = ($(el).text() || ``).toLowerCase();
		return text.includes(`veranstalter`) && text.includes(`veranstaltungsort`);
	});
	if (combinedHeading.length > 0) {
		const organizerName = superTrim(combinedHeading.first().nextAll(`h4, h5`).first().text());
		if (organizerName) return organizerName;
	}

	const organizer = readEvent(html)?.organizer;
	if (organizer && typeof organizer === `object`) {
		return textValue(organizer.name);
	}

	return undefined;
}

export function getHostLink(html: string): string | undefined {
	const $ = cheerio.load(html);
	const linksHeading = $(`h3`).filter((_i, el) =>
		($(el).text() || ``).toLowerCase().includes(`weiterführende links`),
	);
	if (linksHeading.length > 0) {
		const nextLink = linksHeading.first().nextAll(`a`).first();
		const href = nextLink.attr(`href`);
		if (href) return href;
	}

	const organizer = readEvent(html)?.organizer;
	if (organizer && typeof organizer === `object` && typeof organizer.url === `string`) {
		return organizer.url.replace(/&amp;/g, `&`) || undefined;
	}

	return undefined;
}

export function getTags(html: string): string[] | undefined {
	const $ = cheerio.load(html);
	const tagsSet = new Set<string>();

	const keywords = $(`meta[name="keywords"]`).attr(`content`);
	if (keywords) {
		for (const keyword of keywords.split(`,`)) {
			const trimmed = keyword.trim();
			if (trimmed.length > 0 && trimmed.length < 50) tagsSet.add(trimmed);
		}
	}

	return tagsSet.size > 0 ? [...tagsSet] : undefined;
}

export function resolveEmail(description: string) {
	const emailRegex = /<script>emailtext\((.*)\);<\/script>/;
	const match = description.match(emailRegex);
	if (!match) return description;

	const [username, domain, tld] = match[1].replaceAll(`'`, ``).replaceAll(` `, ``).split(`,`);
	const email = `${username}@${domain}.${tld}`;
	return description.replace(
		/<script>emailtext\(.*<\/noscript><\/object>/,
		`<a href="mailto:${email}">${email}</a>`,
	);
}

function readEvent(html: string): LdEvent | undefined {
	const $ = cheerio.load(html);
	for (const el of $(`script[type="application/ld+json"]`).toArray()) {
		const text = $(el).html() || $(el).text();
		if (!text?.includes(`Event`)) continue;
		try {
			const parsed = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ` `)) as unknown;
			const event = ldNodes(parsed).find((node) => node?.[`@type`] === `Event`);
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

function parseLdDate(value: unknown): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const raw = normalizeIsoOffset(value.trim());
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return undefined;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;
	return raw;
}

/** Site emits `+0200`; normalize to `+02:00`. */
function normalizeIsoOffset(raw: string): string {
	return raw.replace(/([+-]\d{2})(\d{2})$/, `$1:$2`);
}

function dateHeadingText(html: string): string {
	const $ = cheerio.load(html);
	const heading =
		superTrim($(`h2.legacy_h5`).first().text()) ||
		superTrim($(`h5`).first().text()) ||
		``;
	return heading.replace(/[\u200B-\u200D\uFEFF]/g, ``);
}

function parseHeadingStart(html: string): string | undefined {
	const text = dateHeadingText(html);
	if (!text) return undefined;

	const multiDayMatch = text.match(
		/(\d{2})\.(\d{2})\.(\d{4})\s+bis\s+\d{2}\.\d{2}\.\d{4}\s+(?:von|um)\s+(\d{1,2}):(\d{2})/,
	);
	if (multiDayMatch) {
		return dateToIsoStr(
			Number(multiDayMatch[3]),
			Number(multiDayMatch[2]) - 1,
			Number(multiDayMatch[1]),
			Number(multiDayMatch[4]),
			Number(multiDayMatch[5]),
			DEFAULT_TIMEZONE,
			true,
		);
	}

	const singleDayMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(?:von|um)\s+(\d{1,2}):(\d{2})/);
	if (singleDayMatch) {
		return dateToIsoStr(
			Number(singleDayMatch[3]),
			Number(singleDayMatch[2]) - 1,
			Number(singleDayMatch[1]),
			Number(singleDayMatch[4]),
			Number(singleDayMatch[5]),
			DEFAULT_TIMEZONE,
			true,
		);
	}

	return undefined;
}

function parseHeadingEnd(html: string): string | undefined {
	const text = dateHeadingText(html);
	if (!text) return undefined;

	const multiDayMatch = text.match(/\d{2}\.\d{2}\.\d{4}\s+bis\s+(\d{2})\.(\d{2})\.(\d{4})/);
	if (multiDayMatch) {
		const endHourMinute = text.match(/(?:von|um)\s+\d{1,2}:\d{2}\s*[–-]\s*(\d{1,2}):(\d{2})/);
		const endHour = endHourMinute ? Number(endHourMinute[1]) : 15;
		const endMinute = endHourMinute ? Number(endHourMinute[2]) : 0;
		return dateToIsoStr(
			Number(multiDayMatch[3]),
			Number(multiDayMatch[2]) - 1,
			Number(multiDayMatch[1]),
			endHour,
			endMinute,
			DEFAULT_TIMEZONE,
			true,
		);
	}

	const singleDayMatch = text.match(
		/(\d{2})\.(\d{2})\.(\d{4})\s+(?:von|um)\s+\d{1,2}:\d{2}\s*[–-]\s*(\d{1,2}):(\d{2})/,
	);
	if (!singleDayMatch) return undefined;

	return dateToIsoStr(
		Number(singleDayMatch[3]),
		Number(singleDayMatch[2]) - 1,
		Number(singleDayMatch[1]),
		Number(singleDayMatch[4]),
		Number(singleDayMatch[5]),
		DEFAULT_TIMEZONE,
		true,
	);
}

function textValue(value: unknown): string | undefined {
	return typeof value === `string` ? superTrim(value) || undefined : undefined;
}

if (import.meta.main) {
	const scraper = new WebsiteScraper();
	if (process.argv.length > 2) {
		console.log(JSON.stringify(await scraper.scrapeHtmlFiles(process.argv.slice(2)), null, 2));
	} else {
		console.log(JSON.stringify(await scraper.scrapeWebsite(), null, 2));
	}
	process.exit(0);
}

type LdPostalAddress = {
	streetAddress?: string;
	postalCode?: string;
	addressLocality?: string;
	addressCountry?: string;
};

type LdPlace = {
	[`@type`]?: string;
	name?: string;
	address?: string | LdPostalAddress;
	url?: string;
};

type LdOrganizer = {
	name?: string;
	url?: string;
};

type LdEvent = {
	[`@type`]?: string;
	name?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	image?: string | string[];
	location?: LdPlace;
	organizer?: LdOrganizer;
};
