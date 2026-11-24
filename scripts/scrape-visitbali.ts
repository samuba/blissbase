/**
 * Scrapes visitbali.id events from `sitemap_events.xml` and the `/events`
 * listing (when it has cards), then enriches each `/events/details/{slug}` page.
 * Upcoming calendar is often empty; past sitemap entries are skipped.
 *
 * Usage:
 *   bun run scripts/scrape-visitbali.ts
 *   bun run scripts/scrape-visitbali.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl as commonMakeAbsoluteUrl,
	REQUEST_DELAY_MS,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://visitbali.id`;
const EVENTS_LIST_URL = `${SITE_BASE}/events`;
const EVENTS_SITEMAP_URL = `${SITE_BASE}/sitemap_events.xml`;
const SOURCE = `visitbali` as const;
const TIMEZONE = `Asia/Makassar` as const;
const UPCOMING_GRACE_MS = 6 * 60 * 60 * 1000;
const DETAIL_PATH = `/events/details/`;
const MAX_LIST_PAGES = 30;

const MONTH_INDEX: Record<string, number> = {
	january: 0,
	february: 1,
	march: 2,
	april: 3,
	may: 4,
	june: 5,
	july: 6,
	august: 7,
	september: 8,
	october: 9,
	november: 10,
	december: 11,
};

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		const urls = await this.collectEventUrls();
		console.error(`Fetching ${urls.length} VisitBali event detail pages...`);

		for (const url of urls) {
			try {
				await sleep(REQUEST_DELAY_MS);
				const html = await customFetch(url, { returnType: `text` });
				const event = await this.extractEventData(html, url);
				if (!event) continue;
				if (!isUpcomingStart(event.startAt)) {
					console.error(`Skipping past event ${url}`);
					continue;
				}
				allEvents.push(event);
			} catch (error) {
				console.error(`Failed to process ${url}:`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
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

			const address = this.extractAddress(html) ?? [];
			let latitude: number | null = null;
			let longitude: number | null = null;
			let timezone: string | null = TIMEZONE;

			const apiKey = process.env.GOOGLE_MAPS_API_KEY;
			if (address?.length && apiKey) {
				try {
					const geocoded = await geocodeAddressCached({
						addressLines: [...address, `Bali`, `Indonesia`],
						apiKey,
					});
					latitude = geocoded?.lat ?? null;
					longitude = geocoded?.lng ?? null;
					timezone = geocoded?.timezone ?? timezone;
				} catch (error) {
					console.error(`Geocoding failed for ${url}:`, error);
				}
			}

			return {
				name,
				startAt,
				endAt: this.extractEndAt(html),
				address,
				price: this.extractPrice(html),
				priceIsHtml: false,
				description: this.extractDescription(html),
				imageUrls: this.extractImageUrls(html) ?? [],
				host: this.extractHost(html),
				hostLink: this.extractHostLink(html),
				contact: [],
				latitude,
				longitude,
				timezone,
				tags: this.extractTags(html) ?? [],
				sourceUrl: canonicalizeDetailUrl(url),
				source: SOURCE,
			} satisfies ScrapedEvent;
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		const $ = cheerio.load(html);
		const h1 = superTrim($(`.event-detail__body-content h1`).first().text());
		if (h1) return h1;
		return superTrim($(`h1`).first().text()) || undefined;
	}

	extractStartAt(html: string): string | undefined {
		return this.extractSchedule(html).startAt;
	}

	extractEndAt(html: string): string | undefined {
		return this.extractSchedule(html).endAt;
	}

	extractAddress(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const raw = superTrim($(`.event-detail__body-sidebar address`).first().text());
		if (!raw) return undefined;
		const lines = raw
			.split(`,`)
			.map((part) => superTrim(part))
			.filter((part): part is string => !!part);
		return lines?.length ? lines : undefined;
	}

	extractPrice(html: string): string | undefined {
		const $ = cheerio.load(html);
		const price = superTrim($(`.event-detail__body-content > span`).first().text());
		return price || undefined;
	}

	extractDescription(html: string): string | undefined {
		const $ = cheerio.load(html);
		const detailsHeading = $(`.event-detail__body-content h3`)
			.filter((_, el) => superTrim($(el).text())?.toLowerCase() === `details`)
			.first();
		// Nested <p> in source HTML is flattened by cheerio into sibling paragraphs.
		const parts: string[] = [];
		let node = detailsHeading.next();
		while (node.length && node.is(`p`)) {
			const inner = node.html()?.trim();
			if (inner && !/^<br\s*\/?>$/i.test(inner)) parts.push(inner);
			node = node.next();
		}
		return cleanProseHtml(parts.join(``)) || undefined;
	}

	extractImageUrls(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const urls: string[] = [];
		const push = (src: string | undefined) => {
			const absolute = makeAbsoluteUrl(src)?.split(`?`)[0];
			if (!absolute || urls.includes(absolute)) return;
			urls.push(absolute);
		};

		push($(`.figure-event img.img-detail`).first().attr(`src`));
		push($(`.img-detail`).first().attr(`src`));

		const og = $(`meta[property="og:image"]`).attr(`content`)?.trim();
		if (og?.startsWith(`http`)) push(og);

		return urls?.length ? urls : undefined;
	}

	extractHost(_html: string): string | undefined {
		return undefined;
	}

	extractHostLink(_html: string): string | undefined {
		return undefined;
	}

	extractTags(_html: string): string[] | undefined {
		return undefined;
	}

	private extractSchedule(html: string): { startAt: string | undefined; endAt: string | undefined } {
		const $ = cheerio.load(html);
		const sidebar = $(`.event-detail__body-sidebar`);
		const startDateText = labeledSidebarValue({ $, sidebar, label: `Start` });
		const endDateText = labeledSidebarValue({ $, sidebar, label: `End` });
		const timesText = labeledSidebarValue({ $, sidebar, label: `Times` });
		const { startTime, endTime } = parseTimes(timesText);

		const startAt = combineDateAndTime({ dateText: startDateText, time: startTime ?? { hour: 0, minute: 0 } });
		const endAt = combineDateAndTime({
			dateText: endDateText || startDateText,
			time: endTime ?? startTime ?? { hour: 0, minute: 0 },
		});

		if (!startAt) return { startAt: undefined, endAt: undefined };
		if (!endAt || endAt === startAt) return { startAt, endAt: undefined };
		return { startAt, endAt };
	}

	private async collectEventUrls(): Promise<string[]> {
		const urls = new Set<string>();

		try {
			console.error(`Fetching VisitBali events sitemap...`);
			const sitemapXml = await customFetch(EVENTS_SITEMAP_URL, { returnType: `text` });
			for (const url of parseSitemapEventUrls(sitemapXml)) urls.add(url);
			console.error(`  sitemap urls: ${urls.size}`);
		} catch (error) {
			console.error(`Failed to fetch events sitemap:`, error);
		}

		try {
			console.error(`Fetching VisitBali events listing...`);
			const listingUrls = await this.fetchListingEventUrls();
			for (const url of listingUrls) urls.add(url);
			console.error(`  listing urls: ${listingUrls.length}`);
		} catch (error) {
			console.error(`Failed to fetch events listing:`, error);
		}

		return [...urls];
	}

	private async fetchListingEventUrls(): Promise<string[]> {
		const urls = new Set<string>();
		const firstHtml = await customFetch(EVENTS_LIST_URL, { returnType: `text` });
		for (const url of parseListingEventUrls(firstHtml)) urls.add(url);

		for (let page = 2; page <= MAX_LIST_PAGES; page++) {
			await sleep(REQUEST_DELAY_MS);
			const payload = await customFetch(`${EVENTS_LIST_URL}?page=${page}`, {
				returnType: `json`,
				headers: {
					Accept: `application/json`,
					'X-Requested-With': `XMLHttpRequest`,
				},
			});
			const pageHtml = typeof payload?.html === `string` ? payload.html : ``;
			if (!pageHtml.trim()) break;
			const pageUrls = parseListingEventUrls(pageHtml);
			if (!pageUrls?.length) break;
			for (const url of pageUrls) urls.add(url);
		}

		return [...urls];
	}
}

function parseSitemapEventUrls(xml: string): string[] {
	const urls: string[] = [];
	const re = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(xml)) !== null) {
		const url = canonicalizeDetailUrl(match[1]);
		if (url.includes(DETAIL_PATH)) urls.push(url);
	}
	return urls;
}

function parseListingEventUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls: string[] = [];
	$(`.home-events__card a[href*="/events/details/"]`).each((_, el) => {
		const href = $(el).attr(`href`);
		const absolute = makeAbsoluteUrl(href);
		if (!absolute?.includes(DETAIL_PATH)) return;
		const canonical = canonicalizeDetailUrl(absolute);
		if (!urls.includes(canonical)) urls.push(canonical);
	});
	return urls;
}

function labeledSidebarValue({
	$,
	sidebar,
	label,
}: {
	$: cheerio.CheerioAPI;
	sidebar: cheerio.Cheerio<any>;
	label: string;
}): string | undefined {
	const needle = label.trim().toLowerCase();
	const span = sidebar.find(`span`).filter((_, el) => {
		const text = superTrim($(el).text())?.toLowerCase() ?? ``;
		return text === needle || text.startsWith(needle);
	}).first();
	if (!span.length) return undefined;
	return superTrim(span.next(`p`).first().text()) || undefined;
}

function parseTimes(timesText: string | undefined): {
	startTime: ClockTime | undefined;
	endTime: ClockTime | undefined;
} {
	if (!timesText) return { startTime: undefined, endTime: undefined };
	const parts = timesText.split(`-`).map((part) => part.trim()).filter(Boolean);
	return {
		startTime: parseClock(parts[0]),
		endTime: parseClock(parts[1] ?? parts[0]),
	};
}

function parseClock(value: string | undefined): ClockTime | undefined {
	if (!value) return undefined;
	const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
	if (!match) return undefined;
	let hour = Number(match[1]);
	const minute = Number(match[2]);
	const meridiem = match[3].toUpperCase();
	if (meridiem === `PM` && hour !== 12) hour += 12;
	if (meridiem === `AM` && hour === 12) hour = 0;
	return { hour, minute };
}

function parseEnglishDate(dateText: string | undefined): { year: number; month: number; day: number } | undefined {
	if (!dateText) return undefined;
	const match = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
	if (!match) return undefined;
	const day = Number(match[1]);
	const month = MONTH_INDEX[match[2].toLowerCase()];
	const year = Number(match[3]);
	if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;
	return { year, month, day };
}

function combineDateAndTime({
	dateText,
	time,
}: {
	dateText: string | undefined;
	time: ClockTime;
}): string | undefined {
	const date = parseEnglishDate(dateText);
	if (!date) return undefined;
	return dateToIsoStr(date.year, date.month, date.day, time.hour, time.minute, TIMEZONE, true);
}

function makeAbsoluteUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	return commonMakeAbsoluteUrl(url, SITE_BASE);
}

function canonicalizeDetailUrl(url: string): string {
	try {
		const parsed = new URL(url, SITE_BASE);
		parsed.hash = ``;
		parsed.search = ``;
		const path = parsed.pathname.replace(/\/+$/, ``);
		return `${parsed.origin}${path}`;
	} catch {
		return url.split(`?`)[0].replace(/\/+$/, ``);
	}
}

function isUpcomingStart(startAt: string): boolean {
	const ms = Date.parse(startAt);
	if (Number.isNaN(ms)) return false;
	return ms >= Date.now() - UPCOMING_GRACE_MS;
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const fileArgs = process.argv.slice(2).filter((arg) => !arg.startsWith(`-`));
		const events = fileArgs?.length
			? await scraper.scrapeHtmlFiles(fileArgs)
			: await scraper.scrapeWebsite();
		console.log(JSON.stringify(events.slice(0, 5), null, 2));
		console.error(`Sampled ${Math.min(5, events.length)} of ${events.length} events`);
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type ClockTime = { hour: number; minute: number };
