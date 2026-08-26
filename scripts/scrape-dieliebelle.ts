/**
 * Scrapes die-liebelle.de. The /kalender/ poster grid links to offering
 * pages (descriptions, dates, prices). Recurring "Kloster online" sessions
 * are skipped; only future occurrences are returned.
 *
 * Usage:
 *   bun run scripts/scrape-dieliebelle.ts
 *   bun run scripts/scrape-dieliebelle.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	REQUEST_DELAY_MS,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	sleep,
	superTrim,
	type TimeZoneString,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://www.die-liebelle.de`;
const CALENDAR_URL = `${SITE_BASE}/kalender/`;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const SOURCE = `dieliebelle` as const;
const VENUE_ADDRESS = [`DIE LIEBE.LLE Seminarhaus`, `Stufenweg 6`, `32457 Porta Westfalica`];
const HOST_DEFAULT = `DIE LIEBE.LLE`;
const PRIVACY_URL = `${SITE_BASE}/j/privacy`;

const SKIP_PATHS = new Set([
	`/`,
	`/kalender/`,
	`/galerie/`,
	`/newsletter/`,
	`/in-kontakt/`,
	`/über-uns/`,
	`/about/`,
	`/schamanisches/`,
	`/klang-körper/`,
	`/spirit/`,
	`/forschen/`,
	`/spirit/kloster-online/`,
]);

const MONTHS: Record<string, number> = {
	januar: 1,
	februar: 2,
	märz: 3,
	maerz: 3,
	april: 4,
	mai: 5,
	juni: 6,
	juli: 7,
	august: 8,
	september: 9,
	oktober: 10,
	november: 11,
	dezember: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS).join(`|`);
const SKIP_IMAGE_ALT = /liebespost|in kontak|instagram|weiterleitung auf instagram/i;
const STOP_HEADER = /^(jetzt anmelden|hier anmelden|anmelden|anmeldung|überblick|auf einen blick|übersicht)$/i;
const SKIP_CONTACT = /die-liebelle\.de|jimcdn\.com|jimstatic\.com/i;
const SKIP_PAGE_SITE = /instagram\.com|facebook\.com|youtube\.com|youtu\.be|twitter\.com|tiktok\.com/i;
const LEITUNG_STOP = /^(zeiten|termine?|kosten|seminarkosten|energieausgleich|besonderheiten|anmelden|überblick|uhrzeit)/i;
const LEITUNG_BIO = /^(wasser|raumhalter|yogalehrer|heilpraktiker|musiker|sozialarbeiter|seit\s+\d{4}|lebenspraktiker)/i;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		console.error(`Fetching Liebelle calendar...`);
		let calendarHtml: string;
		try {
			calendarHtml = await customFetch(CALENDAR_URL, { returnType: `text` });
		} catch (error) {
			console.error(`Failed to fetch calendar:`, error);
			return [];
		}

		return await this.scrapeFromCalendarHtml(calendarHtml);
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				if (isCalendarHtml(html)) {
					allEvents.push(...(await this.scrapeFromCalendarHtml(html)));
					continue;
				}

				const url = inferFileUrl(filePath);
				const events = await this.eventsFromOfferingPage({
					html,
					url,
					posters: [],
					email: undefined,
				});
				allEvents.push(...events);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return allEvents;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		try {
			const events = await this.eventsFromOfferingPage({
				html,
				url,
				posters: [],
				email: undefined,
			});
			return events[0];
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		const $ = cheerio.load(html);
		const $content = contentRoot($);
		const h1 = superTrim($content.find(`h1`).first().text()) || superTrim($(`h1`).first().text());
		if (!h1) return undefined;

		const h2 = superTrim($content.find(`h2`).first().text());
		if (!h2 || h2.toLowerCase() === h1.toLowerCase()) return h1;
		return `${h1} — ${h2}`;
	}

	extractStartAt(html: string): string | undefined {
		const occurrence = this.extractOccurrences(html)[0];
		if (!occurrence) return undefined;
		return toIso({
			year: occurrence.start.year,
			month: occurrence.start.month,
			day: occurrence.start.day,
			hour: occurrence.startTime.hour,
			minute: occurrence.startTime.minute,
		});
	}

	extractEndAt(html: string): string | undefined {
		const occurrence = this.extractOccurrences(html)[0];
		if (!occurrence) return undefined;
		return endIso(occurrence);
	}

	extractAddress(html: string): string[] | undefined {
		const occurrence = this.extractOccurrences(html)[0];
		return addressFor(occurrence?.location ?? `porta`);
	}

	extractPrice(html: string): string | undefined {
		return parsePrice(contentText(html));
	}

	extractDescription(html: string): string | undefined {
		const $ = cheerio.load(html);
		const $content = contentRoot($);
		if (!$content.length) return undefined;

		const parts: string[] = [];
		let strippedOpening = false;
		for (const el of $content.find(`.j-module`).toArray()) {
			const $el = $(el);
			if ($el.hasClass(`j-formnew`) || $el.hasClass(`j-hgrid`)) continue;
			if ($el.hasClass(`j-imageSubtitle`) || $el.hasClass(`j-spacing`)) continue;

			if ($el.hasClass(`j-header`)) {
				const heading = superTrim($el.text()) ?? ``;
				if (STOP_HEADER.test(heading)) break;
				const tag = $el.find(`h1,h2,h3,h4`).first().prop(`tagName`)?.toLowerCase() || `h3`;
				if (tag === `h1` || tag === `h2`) continue;
				parts.push(`<${tag}>${escapeHtml(heading)}</${tag}>`);
				continue;
			}

			if ($el.hasClass(`j-text`)) {
				const clone = $el.clone();
				clone.find(`script, style`).remove();
				if (!strippedOpening) {
					stripLeadingDateParagraphs(clone);
					strippedOpening = true;
				}
				const inner = clone.html()?.trim();
				if (inner) parts.push(inner);
			}
		}

		if (!parts?.length) return undefined;
		return cleanProseHtml(parts.join(`\n`)) || undefined;
	}

	extractImageUrls(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const urls: string[] = [];
		const seen = new Set<string>();
		const $content = contentRoot($);

		for (const el of $content.find(`.j-imageSubtitle img, .j-hgrid img`).toArray()) {
			const $img = $(el);
			const alt = $img.attr(`alt`) || ``;
			if (SKIP_IMAGE_ALT.test(alt)) continue;
			const src = fullJimdoImageUrl($img.attr(`src`) || $img.attr(`data-src`));
			if (!src) continue;
			if (seen.has(src)) continue;
			seen.add(src);
			urls.push(src);
			if (urls.length >= 3) break;
		}

		return urls;
	}

	extractHost(html: string): string | undefined {
		return parseLeitung(html).host || parseHost(contentText(html)) || HOST_DEFAULT;
	}

	extractHostLink(html: string): string | undefined {
		const leitung = parseLeitung(html);
		if (leitung.hostLink) return leitung.hostLink;
		const host = this.extractHost(html);
		return extractExternalContacts({
			html,
			description: undefined,
			host,
			hostLink: undefined,
		}).hostLinks[0];
	}

	extractTags(_html: string): string[] | undefined {
		return [];
	}

	extractOccurrences(html: string, name?: string): Occurrence[] {
		const text = contentText(html);
		const times = defaultTimesFor({ text, name });
		const kursSlots = parseKursSlots(text);
		const ranges = extractDateRanges(text);
		const occurrences: Occurrence[] = [];

		for (const range of ranges) {
			if (kursSlots?.length && sameDay(range.start, range.end)) {
				for (const slot of kursSlots) {
					occurrences.push({
						...range,
						startTime: slot.start,
						endTime: slot.end,
					});
				}
				continue;
			}

			const fallback = range.location === `online`
				? { start: clock(18, 0), end: clock(19, 30) }
				: times;
			let startTime = range.startTime ?? fallback.start;
			let endTime = range.endTime ?? fallback.end;
			if (
				sameDay(range.start, range.end) &&
				endTime.hour < startTime.hour &&
				!(endTime.hour === 0 && startTime.hour >= 18)
			) {
				startTime = range.startTime ?? (range.location === `online` ? clock(18, 0) : clock(10, 0));
				endTime = range.endTime ?? (range.location === `online` ? clock(19, 30) : clock(18, 0));
			}

			occurrences.push({
				...range,
				startTime,
				endTime,
			});
		}

		return dedupeOccurrences(occurrences);
	}

	private async scrapeFromCalendarHtml(calendarHtml: string): Promise<ScrapedEvent[]> {
		const posters = this.extractCalendarPosters(calendarHtml);
		const offeringUrls = this.extractOfferingUrls(calendarHtml);
		console.error(`Found ${offeringUrls.length} offering pages, ${posters.length} dated calendar posters`);

		const email = await this.fetchContactEmail();
		const allEvents: ScrapedEvent[] = [];
		const seen = new Set<string>();

		for (const url of offeringUrls) {
			const pagePosters = posters.filter((poster) => poster.pageUrl === url);
			try {
				const html = await customFetch(url, { returnType: `text` });
				const events = await this.eventsFromOfferingPage({
					html,
					url,
					posters: pagePosters,
					email,
				});
				for (const event of events) {
					if (seen.has(event.sourceUrl)) continue;
					seen.add(event.sourceUrl);
					allEvents.push(event);
				}
			} catch (error) {
				console.error(`Failed to process ${url}:`, error);
				for (const poster of pagePosters) {
					try {
						const event = await this.eventFromPosterOnly({ poster, email });
						if (!event || seen.has(event.sourceUrl)) continue;
						seen.add(event.sourceUrl);
						allEvents.push(event);
					} catch (posterError) {
						console.error(`Failed to process calendar poster ${poster.pageUrl}:`, posterError);
					}
				}
			}
			await sleep(REQUEST_DELAY_MS);
		}

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	extractCalendarPosters(html: string): CalendarPoster[] {
		const $ = cheerio.load(html);
		const posters: CalendarPoster[] = [];
		const $content = contentRoot($);

		$content.find(`a[href]`).each((_i, el) => {
			const $a = $(el);
			const href = $a.attr(`href`);
			const $img = $a.find(`img`).first();
			if (!href || !$img.length) return;

			const pageUrl = canonicalizeUrl(makeAbsoluteUrl(href, SITE_BASE) || href);
			if (!pageUrl.startsWith(SITE_BASE)) return;
			if (SKIP_PATHS.has(pathOf(pageUrl))) return;

			const alt = $img.attr(`alt`) || ``;
			const ranges = extractDateRanges(alt);
			if (!ranges?.length) return;

			const timesFromAlt = parseTimesFromText(alt);

			for (const range of ranges) {
				posters.push({
					pageUrl,
					alt,
					range: {
						...range,
						startTime: range.startTime ?? timesFromAlt.start,
						endTime: range.endTime ?? timesFromAlt.end,
					},
				});
			}
		});

		return posters;
	}

	extractOfferingUrls(html: string): string[] {
		const $ = cheerio.load(html);
		const urls = new Set<string>();

		const consider = (href: string | undefined) => {
			if (!href) return;
			const absolute = canonicalizeUrl(makeAbsoluteUrl(href, SITE_BASE) || href);
			if (!absolute.startsWith(SITE_BASE)) return;
			const path = pathOf(absolute);
			if (SKIP_PATHS.has(path)) return;
			if (!isOfferingPath(path)) return;
			urls.add(absolute);
		};

		$(`a[href]`).each((_i, el) => consider($(el).attr(`href`)));
		return [...urls];
	}

	private async eventsFromOfferingPage(args: {
		html: string;
		url: string;
		posters: CalendarPoster[];
		email: string | undefined;
	}): Promise<ScrapedEvent[]> {
		const name = this.extractName(args.html);
		if (!name) {
			console.error(`Skipping ${args.url}: missing name`);
			return [];
		}

		const pageOccurrences = this.extractOccurrences(args.html, name);
		const merged = mergeOccurrences({
			fromPage: pageOccurrences,
			posters: args.posters,
		});
		if (!merged?.length) {
			console.error(`Skipping ${args.url} (${name}): no dates found`);
			return [];
		}

		const description = this.extractDescription(args.html);
		const price = this.extractPrice(args.html);
		const leitung = parseLeitung(args.html);
		const host = leitung.host || parseHost(contentText(args.html)) || HOST_DEFAULT;
		const pageImages = this.extractImageUrls(args.html) ?? [];
		const externalContacts = extractExternalContacts({
			html: args.html,
			description,
			host,
			hostLink: leitung.hostLink,
		});
		const events: ScrapedEvent[] = [];

		for (const occurrence of merged) {
			try {
				const event = await this.toScrapedEvent({
					name,
					occurrence,
					pageUrl: canonicalizeUrl(args.url),
					description,
					price,
					host,
					imageUrls: pageImages,
					email: args.email,
					externalContacts,
				});
				if (!event) continue;
				events.push(event);
				console.error(`✓ ${event.name} (${event.startAt})`);
			} catch (error) {
				console.error(`Failed to map occurrence on ${args.url}:`, error);
			}
		}

		return events;
	}

	private async eventFromPosterOnly(args: {
		poster: CalendarPoster;
		email: string | undefined;
	}): Promise<ScrapedEvent | undefined> {
		const name = nameFromAlt(args.poster.alt);
		if (!name) return undefined;

		const times = defaultTimesFor({ text: args.poster.alt, name });
		return await this.toScrapedEvent({
			name,
			occurrence: {
				...args.poster.range,
				startTime: args.poster.range.startTime ?? times.start,
				endTime: args.poster.range.endTime ?? times.end,
			},
			pageUrl: args.poster.pageUrl,
			description: undefined,
			price: undefined,
			host: HOST_DEFAULT,
			imageUrls: [],
			email: args.email,
			externalContacts: { booking: [], sites: [], hostLinks: [], onPageForm: false },
		});
	}

	private async toScrapedEvent(args: {
		name: string;
		occurrence: Occurrence;
		pageUrl: string;
		description: string | undefined;
		price: string | undefined;
		host: string | undefined;
		imageUrls: string[];
		email: string | undefined;
		externalContacts: ExternalContacts;
	}): Promise<ScrapedEvent | undefined> {
		const startAt = toIso({
			year: args.occurrence.start.year,
			month: args.occurrence.start.month,
			day: args.occurrence.start.day,
			hour: args.occurrence.startTime.hour,
			minute: args.occurrence.startTime.minute,
		});
		const endAt = endIso(args.occurrence);
		if (!isUpcoming({ startAt, endAt })) {
			console.error(`Skipping past event ${args.name} (${startAt})`);
			return undefined;
		}
		if (endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
			console.error(`Skipping invalid range ${args.name} (${startAt} – ${endAt})`);
			return undefined;
		}

		const address = addressFor(args.occurrence.location);
		let latitude: number | null = null;
		let longitude: number | null = null;
		let timezone: string | null = DEFAULT_TIMEZONE;

		if (args.occurrence.location !== `online`) {
			try {
				const geocoded = await geocodeAddressCached({
					addressLines: address,
					apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
				});
				latitude = geocoded?.lat ?? null;
				longitude = geocoded?.lng ?? null;
				timezone = geocoded?.timezone ?? timezone;
			} catch (error) {
				console.error(`Geocoding failed for ${args.pageUrl}:`, error);
			}
		}

		return {
			name: args.name,
			startAt,
			endAt,
			address,
			price: args.price,
			priceIsHtml: false,
			description: args.description,
			imageUrls: args.imageUrls,
			host: args.host || HOST_DEFAULT,
			hostLink: args.externalContacts.hostLinks[0],
			contact: contactsForOccurrence({
				externalContacts: args.externalContacts,
				occurrence: args.occurrence,
				email: args.email,
				pageUrl: args.pageUrl,
			}),
			latitude,
			longitude,
			timezone,
			tags: [],
			sourceUrl: occurrenceSourceUrl({
				pageUrl: args.pageUrl,
				occurrence: args.occurrence,
			}),
			source: SOURCE,
		} satisfies ScrapedEvent;
	}

	private async fetchContactEmail(): Promise<string | undefined> {
		try {
			const html = await customFetch(PRIVACY_URL, { returnType: `text` });
			return decodeCfEmails(html)[0];
		} catch (error) {
			console.error(`Could not fetch contact email:`, error);
			return undefined;
		}
	}
}

function contentRoot($: cheerio.CheerioAPI | cheerio.Root) {
	const $content = $(`[data-container="content"]`).first();
	return $content.length ? $content : $.root();
}

function contentText(html: string): string {
	const $ = cheerio.load(html);
	const $content = contentRoot($).clone();
	$content.find(`form, script, style, .j-formnew`).remove();
	return normalizeDateText($content.text());
}

function extractDateRanges(text: string): DateRange[] {
	const normalized = normalizeDateText(text);
	const matches: { start: number; end: number; range: DateRange }[] = [];

	const push = (args: {
		index: number;
		length: number;
		startDay: number;
		startMonth: number;
		endDay: number;
		endMonth: number;
		year?: number;
		location?: OccurrenceLocation;
		startTime?: ClockTime;
		endTime?: ClockTime;
	}) => {
		if (isOverlapping({ matches, index: args.index, length: args.length })) return;
		const before = normalized.slice(Math.max(0, args.index - 40), args.index);
		if (/bis\s+zum\s*$/i.test(before) || /frühbucher/i.test(before)) return;

		const year =
			args.year ||
			yearNear({ text: normalized, index: args.index, length: args.length });
		if (!year) return;
		if (!isValidDate(year, args.startMonth, args.startDay)) return;
		if (!isValidDate(year, args.endMonth, args.endDay)) return;

		const aroundAfter = normalized.slice(
			args.index + args.length,
			args.index + args.length + 18,
		);
		const aroundBefore = normalized.slice(Math.max(0, args.index - 160), args.index);
		const localTimes = parseTimesFromText(
			normalized.slice(Math.max(0, args.index - 20), args.index + args.length + 48),
		);
		matches.push({
			start: args.index,
			end: args.index + args.length,
			range: {
				start: { year, month: args.startMonth, day: args.startDay },
				end: {
					year: args.endMonth < args.startMonth ? year + 1 : year,
					month: args.endMonth,
					day: args.endDay,
				},
				location: args.location ?? locationFromContext({
					before: aroundBefore,
					after: aroundAfter,
				}),
				startTime: args.startTime ?? localTimes.start,
				endTime: args.endTime ?? localTimes.end,
			},
		});
	};

	for (const match of normalized.matchAll(
		/(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.\s*(\d{4})/g,
	)) {
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: Number(match[2]),
			endDay: Number(match[3]),
			endMonth: Number(match[4]),
			year: Number(match[5]),
		});
	}

	for (const match of normalized.matchAll(
		/(\d{1,2})\.\s*[\/–-]\s*(\d{1,2})\.(\d{1,2})\.\s*(\d{4})/g,
	)) {
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: Number(match[3]),
			endDay: Number(match[2]),
			endMonth: Number(match[3]),
			year: Number(match[4]),
		});
	}

	const namedRange = new RegExp(
		`(\\d{1,2})\\.\\s*[-–]\\s*(\\d{1,2})\\.\\s*(${MONTH_PATTERN})(?:\\s+(\\d{4}))?`,
		`gi`,
	);
	for (const match of normalized.matchAll(namedRange)) {
		const month = MONTHS[match[3].toLowerCase()];
		if (!month) continue;
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: month,
			endDay: Number(match[2]),
			endMonth: month,
			year: match[4] ? Number(match[4]) : undefined,
		});
	}

	const namedSingle = new RegExp(
		`(\\d{1,2})\\.\\s*(${MONTH_PATTERN})\\s+(\\d{4})`,
		`gi`,
	);
	for (const match of normalized.matchAll(namedSingle)) {
		const month = MONTHS[match[2].toLowerCase()];
		if (!month) continue;
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: month,
			endDay: Number(match[1]),
			endMonth: month,
			year: Number(match[3]),
		});
	}

	for (const match of normalized.matchAll(/(\d{1,2})\.(\d{1,2})\.\s*(\d{4})/g)) {
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: Number(match[2]),
			endDay: Number(match[1]),
			endMonth: Number(match[2]),
			year: Number(match[3]),
		});
	}

	for (const match of normalized.matchAll(/(\d{1,2})\.(\d{1,2})\.(?!\s*\d)/g)) {
		push({
			index: match.index ?? 0,
			length: match[0].length,
			startDay: Number(match[1]),
			startMonth: Number(match[2]),
			endDay: Number(match[1]),
			endMonth: Number(match[2]),
		});
	}

	matches.sort((a, b) => a.start - b.start);
	return matches.map((item) => item.range);
}

function mergeOccurrences(args: {
	fromPage: Occurrence[];
	posters: CalendarPoster[];
}): Occurrence[] {
	const byDate = new Map<string, Occurrence[]>();
	const dateKey = (date: Ymd) => `${date.year}-${date.month}-${date.day}`;

	for (const occurrence of args.fromPage) {
		const key = dateKey(occurrence.start);
		const list = byDate.get(key) ?? [];
		list.push(occurrence);
		byDate.set(key, list);
	}

	for (const poster of args.posters) {
		const key = dateKey(poster.range.start);
		const existing = byDate.get(key);
		if (existing?.length) {
			const timed = poster.range.startTime
				? existing.find((item) => item.startTime.hour === poster.range.startTime?.hour)
				: undefined;
			const target = timed ?? existing[0];
			if (poster.range.startTime) target.startTime = poster.range.startTime;
			if (poster.range.endTime) target.endTime = poster.range.endTime;
			if (poster.range.location !== `porta`) target.location = poster.range.location;
			continue;
		}

		const times = defaultTimesFor({ text: poster.alt });
		const list = byDate.get(key) ?? [];
		list.push({
			...poster.range,
			startTime: poster.range.startTime ?? times.start,
			endTime: poster.range.endTime ?? times.end,
		});
		byDate.set(key, list);
	}

	return dedupeOccurrences([...byDate.values()].flat());
}

function defaultTimesFor(args: { text: string; name?: string }): { start: ClockTime; end: ClockTime } {
	const parsed = parseDefaultTimes(args.text);
	if (parsed) return parsed;
	if (/\b(heilabend|gesang|rapé)\b/i.test(args.name || args.text.slice(0, 80))) {
		return { start: clock(19, 0), end: clock(21, 30) };
	}
	return { start: clock(10, 0), end: clock(18, 0) };
}

function parseDefaultTimes(text: string): { start: ClockTime; end: ClockTime } | undefined {
	const weekend = text.match(
		/freitag\s+um\s+(\d{1,2})(?:[.:](\d{2}))?\s*uhr[\s\S]{0,80}?sonntag\s+um\s+(\d{1,2})(?:[.:](\d{2}))?\s*uhr/i,
	);
	if (weekend) {
		return {
			start: clock(Number(weekend[1]), Number(weekend[2] || 0)),
			end: clock(Number(weekend[3]), Number(weekend[4] || 0)),
		};
	}

	const satSun = text.match(
		/samstag[:\s]+(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?[\s\S]{0,50}?sonntag[:\s]+(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?/i,
	);
	if (satSun) {
		return {
			start: clock(Number(satSun[1]), Number(satSun[2] || 0)),
			end: clock(Number(satSun[7]), Number(satSun[8] || 0)),
		};
	}

	const fromUhrzeit = text.match(
		/uhrzeit[:\s]*[\s\S]{0,40}?(\d{1,2})(?:[.:](\d{2}))?\s*(?:[-–]|bis)\s*(\d{1,2})(?:[.:](\d{2}))?/i,
	);
	if (fromUhrzeit) {
		return {
			start: clock(Number(fromUhrzeit[1]), Number(fromUhrzeit[2] || 0)),
			end: clock(Number(fromUhrzeit[3]), Number(fromUhrzeit[4] || 0)),
		};
	}

	const jeweils = text.match(
		/jeweils\s+(?:von\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*(?:[-–]|bis)\s*(\d{1,2})(?:[.:](\d{2}))?/i,
	);
	if (jeweils) {
		return {
			start: clock(Number(jeweils[1]), Number(jeweils[2] || 0)),
			end: clock(Number(jeweils[3]), Number(jeweils[4] || 0)),
		};
	}

	return undefined;
}

function parseTimesFromText(text: string): { start?: ClockTime; end?: ClockTime } {
	const match = text.match(
		/(\d{1,2})(?:[:.](\d{2}))?\s*(?:[-–]|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*uhr/i,
	);
	if (!match) return {};
	return {
		start: clock(Number(match[1]), Number(match[2] || 0)),
		end: clock(Number(match[3]), Number(match[4] || 0)),
	};
}

function parseKursSlots(text: string): { start: ClockTime; end: ClockTime }[] {
	const slots: { start: ClockTime; end: ClockTime }[] = [];
	for (const match of text.matchAll(
		/kurs\s*\d+\s*:\s*(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?/gi,
	)) {
		slots.push({
			start: clock(Number(match[1]), Number(match[2] || 0)),
			end: clock(Number(match[3]), Number(match[4] || 0)),
		});
	}
	return slots;
}

function parsePrice(text: string): string | undefined {
	const match = text.match(
		/(?:energieausgleich|kosten)[^€]{0,80}?(\d[\d\s.,-]*€(?:\s*\([^)]{0,40}\))?)/i,
	);
	if (!match) return undefined;
	const raw = superTrim(
		match[1]
			.replace(/(\d)\s+(\d)/g, `$1$2`)
			.replace(/\s+/g, ` `)
			.replace(/,\s+-/g, `,-`),
	);
	if (!raw) return undefined;
	return raw.replace(/\s+(jetzt|bitte|hier).*$/i, ``).trim() || undefined;
}

function parseHost(text: string): string | undefined {
	const match = text.match(
		/(?:\bleitung\b|\bgestalter(?:innen)?\b)\s*:?\s*([\s\S]+?)(?=\s+(?:energieausgleich|seminarkosten|\bkosten[:\s]|jetzt anmelden|hier anmelden|\banmelden\b|besonderheiten|zugang|zusätzliche)|$)/i,
	);
	if (!match) return undefined;
	const cleaned = match[1]
		.replace(/\s+/g, ` `)
		.replace(/\s*,\s*.*$/, ``)
		.replace(/\s+(musikerin|yogalehrerin|heilpraktiker|lebenspraktikerin|energieausgleich|wassergießer|raumhalterin)\b.*$/i, ``);
	return superTrim(cleaned);
}

function parseLeitung(html: string): { host?: string; hostLink?: string } {
	const $ = cheerio.load(html);
	const $content = contentRoot($);

	for (const el of $content.find(`.j-text p`).toArray()) {
		const $p = $(el);
		const text = superTrim($p.text()) ?? ``;
		if (!/^leitung\b/i.test(text)) continue;

		const names: string[] = [];
		let hostLink: string | undefined;

		const absorb = ($node: cheerio.Cheerio<AnyNode>) => {
			const raw = superTrim($node.text()) ?? ``;
			if (!raw) return `empty`;
			if (LEITUNG_STOP.test(raw)) return `stop`;
			if (names?.length && LEITUNG_BIO.test(raw)) return `stop`;

			for (const anchor of $node.find(`a[href]`).toArray()) {
				const $a = $(anchor);
				if (!superTrim($a.text())) continue;
				const href = $a.attr(`href`);
				const url = normalizeContactHref(makeAbsoluteUrl(href || ``, SITE_BASE) || href);
				if (url) hostLink = hostLink || url;
			}

			const name = cleanLeitungName(raw);
			if (name) names.push(name);
			return `ok`;
		};

		absorb($p);
		let $next = $p.next();
		while ($next.length) {
			if (!$next.is(`p`)) break;
			if (absorb($next) === `stop`) break;
			$next = $next.next();
		}

		if (names?.length || hostLink) {
			return {
				host: names?.length ? names.join(` und `) : undefined,
				hostLink,
			};
		}
	}

	return {};
}

function cleanLeitungName(text: string) {
	const withoutLabel = text.replace(/^leitung\s*:?\s*/i, ``);
	const hadColon = /:\s*$/.test(withoutLabel);
	let value = withoutLabel.replace(/^und\s+/i, ``).replace(/:\s*$/, ``);
	if (hadColon && !value.includes(` `)) return undefined;
	if (!value) return undefined;
	if (LEITUNG_STOP.test(value) || LEITUNG_BIO.test(value)) return undefined;
	return superTrim(value);
}

function extractExternalContacts(args: {
	html: string;
	description: string | undefined;
	host: string | undefined;
	hostLink: string | undefined;
}): ExternalContacts {
	const booking: string[] = [];
	const sites: string[] = [];
	const hostLinks: string[] = [];
	const seen = new Set<string>();

	const consider = (href: string | undefined, kind: `booking` | `site` | `host`) => {
		const url = normalizeContactHref(href);
		if (!url) return;
		const key = url.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		if (kind === `booking`) booking.push(url);
		else if (kind === `host`) hostLinks.push(url);
		else sites.push(url);
	};

	consider(args.hostLink, `host`);

	const $page = cheerio.load(args.html);
	const $content = contentRoot($page);
	for (const el of $content.find(`a[href]`).toArray()) {
		const $a = $page(el);
		const href = superTrim($a.attr(`href`));
		if (!href) continue;
		const text = superTrim($a.text()) ?? ``;
		const around = superTrim($a.closest(`.j-text`).text() || $a.parent().text()) ?? ``;
		if (isBookingLink({ href, text, around })) {
			consider(href, `booking`);
			continue;
		}
		if (!text) continue;
		if (isHostNameLink({ text, host: args.host })) {
			consider(href, `host`);
			continue;
		}
		if (SKIP_PAGE_SITE.test(href)) continue;
		consider(href, `site`);
	}

	if (args.description) {
		const $desc = cheerio.load(args.description);
		for (const el of $desc(`a[href]`).toArray()) {
			const $a = $desc(el);
			const href = $a.attr(`href`);
			const text = superTrim($a.text()) ?? ``;
			if (isHostNameLink({ text, host: args.host })) {
				consider(href, `host`);
				continue;
			}
			consider(href, `site`);
		}
	}

	return {
		booking,
		sites,
		hostLinks,
		onPageForm: $content.find(`.j-formnew, form.cc-m-form`).length > 0,
	};
}

function normalizeContactHref(href: string | undefined): string | undefined {
	const raw = superTrim(href);
	if (!raw) return undefined;
	if (raw.startsWith(`mailto:`)) return raw.slice(`mailto:`.length);
	if (!/^https?:\/\//i.test(raw)) return undefined;
	if (SKIP_CONTACT.test(raw)) return undefined;
	return raw;
}

function isHostNameLink(args: { text: string; host: string | undefined }) {
	if (!args.host || !args.text) return false;
	if (/^hier$/i.test(args.text) || /anmeld/i.test(args.text)) return false;
	return namesOverlap({ a: args.text, b: args.host });
}

function namesOverlap(args: { a: string; b: string }) {
	const a = normalizeName(args.a);
	const b = normalizeName(args.b);
	if (!a || !b) return false;
	if (a.includes(b) || b.includes(a)) return true;
	const aTokens = a.split(` `).filter((token) => token.length > 2);
	if (!aTokens?.length) return false;
	const bTokens = new Set(b.split(` `).filter((token) => token.length > 2));
	return aTokens.filter((token) => bTokens.has(token)).length >= 2;
}

function normalizeName(value: string) {
	return value
		.toLowerCase()
		.normalize(`NFD`)
		.replace(/[\u0300-\u036f]/g, ``)
		.replace(/[^a-z0-9]+/g, ` `)
		.trim();
}

function isBookingLink(args: { href: string; text: string; around: string }) {
	if (/sei\.jetzt/i.test(args.href)) return true;
	if (/anmeld/i.test(args.text)) return true;
	if (!/^hier$/i.test(args.text)) return false;
	if (/kleingedruckt|impressum/i.test(args.around) && !/zur anmeldung|geht es zur anmeld/i.test(args.around)) {
		return false;
	}
	return /anmeld/i.test(args.around);
}

function contactsForOccurrence(args: {
	externalContacts: ExternalContacts;
	occurrence: Occurrence;
	email: string | undefined;
	pageUrl: string;
}) {
	const ymd = `${args.occurrence.start.year}-${pad(args.occurrence.start.month)}-${pad(args.occurrence.start.day)}`;
	const dated = args.externalContacts.booking.filter((url) => url.includes(ymd));
	const booking = dated?.length ? dated : args.externalContacts.booking;
	const onPage =
		args.externalContacts.onPageForm && !booking?.length
			? [
					occurrenceSourceUrl({
						pageUrl: args.pageUrl,
						occurrence: args.occurrence,
					}),
				]
			: [];
	const urls = [...booking, ...onPage, ...args.externalContacts.sites].filter(
		(item): item is string => Boolean(item),
	);
	if (!urls?.length && args.externalContacts.hostLinks[0]) {
		urls.push(args.externalContacts.hostLinks[0]);
	}
	if (args.email && !urls?.length) urls.push(args.email);
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const url of urls) {
		const key = url.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(url);
	}
	return unique;
}

function addressFor(location: OccurrenceLocation): string[] {
	if (location === `online`) return [`Online`];
	if (location === `bielefeld`) return [`Bielefeld`];
	return [...VENUE_ADDRESS];
}

function locationFromContext(args: { before: string; after: string }): OccurrenceLocation {
	if (/bielefeld/i.test(args.after)) return `bielefeld`;
	if (
		/(?:mo|di|mi|do|fr)\s*,\s*$/i.test(args.before) &&
		/\bonline\b/i.test(args.before)
	) {
		return `online`;
	}
	if (/\bonline\b/i.test(`${args.before} ${args.after}`)) return `online`;
	return `porta`;
}

function occurrenceSourceUrl(args: { pageUrl: string; occurrence: Occurrence }): string {
	const date = `${args.occurrence.start.year}-${pad(args.occurrence.start.month)}-${pad(args.occurrence.start.day)}`;
	const params = new URLSearchParams({ datum: date });
	if (args.occurrence.startTime.hour !== 10 || args.occurrence.startTime.minute !== 0) {
		params.set(`von`, `${pad(args.occurrence.startTime.hour)}:${pad(args.occurrence.startTime.minute)}`);
	}
	return `${args.pageUrl}?${params.toString()}`;
}

function endIso(occurrence: Occurrence): string | undefined {
	let endDate = occurrence.end;
	if (
		sameDay(occurrence.start, occurrence.end) &&
		(occurrence.endTime.hour < occurrence.startTime.hour ||
			(occurrence.endTime.hour === occurrence.startTime.hour &&
				occurrence.endTime.minute <= occurrence.startTime.minute))
	) {
		endDate = addDays(occurrence.end, 1);
	}

	const iso = toIso({
		year: endDate.year,
		month: endDate.month,
		day: endDate.day,
		hour: occurrence.endTime.hour,
		minute: occurrence.endTime.minute,
	});
	const start = toIso({
		year: occurrence.start.year,
		month: occurrence.start.month,
		day: occurrence.start.day,
		hour: occurrence.startTime.hour,
		minute: occurrence.startTime.minute,
	});
	if (iso === start) return undefined;
	return iso;
}

function toIso(args: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}) {
	return dateToIsoStr(
		args.year,
		args.month,
		args.day,
		args.hour,
		args.minute,
		DEFAULT_TIMEZONE as TimeZoneString,
		false,
	);
}

function isUpcoming(args: { startAt: string; endAt: string | undefined }) {
	const endMs = new Date(args.endAt || args.startAt).getTime();
	if (Number.isNaN(endMs)) return false;
	return endMs > Date.now();
}

function normalizeDateText(text: string): string {
	return text
		.replace(/(\d)\s+(\d)\s*\./g, `$1$2.`)
		.replace(/(\d{1,2})\.(\d{3})\.(\d{4})/g, (_m, day, month, year) => {
			const asTwo = Math.floor(Number(month) / 10);
			if (asTwo >= 1 && asTwo <= 12) return `${day}.${pad(asTwo)}.${year}`;
			return `${day}.${month}.${year}`;
		})
		.replace(/[–—]/g, `-`)
		.replace(/\s+/g, ` `)
		.trim();
}

function yearNear(args: { text: string; index: number; length: number }): number | undefined {
	const matched = args.text.slice(args.index, args.index + args.length);
	const inMatch = matched.match(/(20\d{2})/);
	if (inMatch) return Number(inMatch[1]);

	const before = args.text.slice(Math.max(0, args.index - 100), args.index);
	const beforeYear = [...before.matchAll(/(20\d{2})/g)].at(-1);
	if (beforeYear) return Number(beforeYear[1]);

	const after = args.text.slice(args.index + args.length, args.index + args.length + 50);
	const afterYear = after.match(/(20\d{2})/);
	if (afterYear) return Number(afterYear[1]);
	return undefined;
}

function dedupeOccurrences(occurrences: Occurrence[]): Occurrence[] {
	const ranges = occurrences.filter((item) => !sameDay(item.start, item.end));
	const singles = occurrences.filter((item) => sameDay(item.start, item.end));
	const uniqueRanges = uniqueByKey(ranges, (item) => `${ymdNum(item.start)}-${ymdNum(item.end)}`);
	const uniqueSingles = uniqueByKey(
		singles,
		(item) => `${ymdNum(item.start)}-${item.startTime.hour}-${item.startTime.minute}`,
	);

	const keptSingles = collapseCloseSingles(
		uniqueSingles.filter((single) => {
			return !uniqueRanges.some((range) => {
				const day = ymdNum(single.start);
				return day >= ymdNum(range.start) && day <= ymdNum(range.end);
			});
		}),
	);

	return [...uniqueRanges, ...keptSingles];
}

function collapseCloseSingles(singles: Occurrence[]): Occurrence[] {
	const byDay = new Map<string, Occurrence[]>();
	for (const single of singles) {
		const key = `${ymdNum(single.start)}-${single.location}`;
		const list = byDay.get(key) ?? [];
		list.push(single);
		byDay.set(key, list);
	}

	const result: Occurrence[] = [];
	for (const list of byDay.values()) {
		if (list.length === 1) {
			result.push(list[0]);
			continue;
		}

		const hours = list.map((item) => item.startTime.hour).sort((a, b) => a - b);
		if (hours[hours.length - 1] - hours[0] >= 3) {
			result.push(...list);
			continue;
		}

		result.push(
			[...list].sort((a, b) => durationMinutes(b) - durationMinutes(a))[0],
		);
	}
	return result;
}

function durationMinutes(occurrence: Occurrence) {
	const start = occurrence.startTime.hour * 60 + occurrence.startTime.minute;
	let end = occurrence.endTime.hour * 60 + occurrence.endTime.minute;
	if (end <= start) end += 24 * 60;
	return end - start;
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const item of items) {
		const key = keyOf(item);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}
	return result;
}

function ymdNum(date: Ymd) {
	return date.year * 10000 + date.month * 100 + date.day;
}

function isOverlapping(args: {
	matches: { start: number; end: number }[];
	index: number;
	length: number;
}) {
	const end = args.index + args.length;
	return args.matches.some((item) => args.index < item.end && end > item.start);
}

function isValidDate(year: number, month: number, day: number) {
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	if (year < 2020 || year > 2040) return false;
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function sameDay(a: Ymd, b: Ymd) {
	return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addDays(date: Ymd, days: number): Ymd {
	const next = new Date(date.year, date.month - 1, date.day + days);
	return {
		year: next.getFullYear(),
		month: next.getMonth() + 1,
		day: next.getDate(),
	};
}

function clock(hour: number, minute: number): ClockTime {
	return { hour, minute };
}

function pad(value: number) {
	return String(value).padStart(2, `0`);
}

function fullJimdoImageUrl(url: string | undefined): string | undefined {
	if (!url?.trim()) return undefined;
	const absolute = makeAbsoluteUrl(url.trim(), SITE_BASE) || url.trim();
	return absolute.replace(/\/transf\/dimension=\d+x\d+:format=\w+\//, `/transf/none/`);
}

function canonicalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = ``;
		parsed.search = ``;
		let path = decodeURI(parsed.pathname);
		if (!path.endsWith(`/`)) path += `/`;
		parsed.pathname = path;
		return parsed.toString();
	} catch {
		return url;
	}
}

function pathOf(url: string): string {
	try {
		return decodeURI(new URL(url).pathname);
	} catch {
		return url;
	}
}

function isOfferingPath(path: string) {
	if (SKIP_PATHS.has(path)) return false;
	return (
		path.startsWith(`/schamanisches/`) ||
		path.startsWith(`/klang-körper/`) ||
		path.startsWith(`/spirit/`) ||
		path.startsWith(`/forschen/`) ||
		path === `/festival/`
	);
}

function isCalendarHtml(html: string) {
	return /data-link-title="Kalender"/.test(html) && /cc-m-hgrid-column/.test(html);
}

function inferFileUrl(filePath: string) {
	return filePath.startsWith(`http`) ? filePath : CALENDAR_URL;
}

function nameFromAlt(alt: string): string | undefined {
	const quoted = alt.match(/[„“‚‘'"«]([^"'„“‚‘»]+)[„“‚‘'"»]/);
	if (quoted) return superTrim(quoted[1]);
	const announcement = alt.match(
		/(?:ankündigung(?: der veranstaltung)?|plakat)\s*[„:'']?\s*([^–—,.]{3,60})/i,
	);
	if (announcement) return superTrim(announcement[1]);
	return superTrim(alt.split(`–`)[0]) || undefined;
}

function decodeCfEmails(html: string): string[] {
	const emails: string[] = [];
	for (const match of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
		const encoded = match[1];
		const key = Number.parseInt(encoded.slice(0, 2), 16);
		let email = ``;
		for (let i = 2; i < encoded.length; i += 2) {
			email += String.fromCharCode(Number.parseInt(encoded.slice(i, i + 2), 16) ^ key);
		}
		if (email.includes(`@`)) emails.push(email);
	}
	return emails;
}

function stripLeadingDateParagraphs($module: cheerio.Cheerio<AnyNode>) {
	while (true) {
		const $first = $module.children(`p`).first();
		if (!$first.length) break;
		const text = superTrim($first.text()) ?? ``;
		if (!text || isOpeningDateBlock(text)) {
			$first.remove();
			continue;
		}
		break;
	}

	const leftover = superTrim($module.text()) ?? ``;
	if (leftover && leftover.length <= 140 && isOpeningDateBlock(leftover)) $module.empty();
}

function isOpeningDateBlock(text: string) {
	if (text.includes(`📅`)) return true;
	if (text.length > 140) return false;
	if (/^(termine|uhrzeit|leitung|kosten|energieausgleich)\b/i.test(text)) return true;
	if (/regelmäßig|jahreslauf|einzeln buchbar/i.test(text)) return true;
	if (/\d{1,2}\.\s*\d{1,2}(?:\.\s*20\d{2})?/.test(text) && /uhr|termin/i.test(text)) return true;
	return false;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

type Ymd = { year: number; month: number; day: number };
type ClockTime = { hour: number; minute: number };
type OccurrenceLocation = `porta` | `bielefeld` | `online`;

type DateRange = {
	start: Ymd;
	end: Ymd;
	location: OccurrenceLocation;
	startTime?: ClockTime;
	endTime?: ClockTime;
};

type Occurrence = DateRange & {
	startTime: ClockTime;
	endTime: ClockTime;
};

type CalendarPoster = {
	pageUrl: string;
	alt: string;
	range: DateRange;
};

type ExternalContacts = {
	booking: string[];
	sites: string[];
	hostLinks: string[];
	onPageForm: boolean;
};

if (import.meta.main) {
	const scraper = new WebsiteScraper();
	const filePaths = process.argv.slice(2);
	const events = filePaths?.length
		? await scraper.scrapeHtmlFiles(filePaths)
		: await scraper.scrapeWebsite();
	console.log(JSON.stringify(events, null, 2));
}
