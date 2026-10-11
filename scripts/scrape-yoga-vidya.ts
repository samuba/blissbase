/**
 * Scrapes yoga-vidya.de seminars via the Solr search listing, then each
 * seminar detail page HTML (field extractors take the full page HTML).
 *
 * Usage:
 *   bun run scripts/scrape-yoga-vidya.ts
 *   bun run scripts/scrape-yoga-vidya.ts --limit 10
 *   bun run scripts/scrape-yoga-vidya.ts --limit=10
 */
import * as cheerio from "cheerio";
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	superTrim,
} from "./common.ts";

const SITE_BASE = `https://www.yoga-vidya.de`;
const SEARCH_URL = `${SITE_BASE}/seminare/suchergebnisse/?tx_solr%5Bq%5D=`;
const SOURCE = `yogavidya` as const;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const DETAIL_CONCURRENCY = 6;
const HOST_DEFAULT = `Yoga Vidya`;
/** Past events still starting within this grace window are kept (ongoing same-day). */
const PAST_GRACE_MS = 12 * 60 * 60 * 1000;
/** Listing + detail scrape horizon — Solr has years of future seminars. */
const MAX_FUTURE_DAYS = 365;

/** Street-level fallbacks when the detail map only has a place name. */
const VENUE_BY_ORT: Record<string, string[]> = {
	"Bad Meinberg": [`Yoga Vidya Bad Meinberg`, `Yogaweg 1`, `32805 Horn-Bad Meinberg`],
	Westerwald: [`Yoga Vidya Westerwald`, `Yogaweg 7`, `57612 Oberlahr`],
	Nordsee: [`Yoga Vidya Nordsee`],
	Allgäu: [`Yoga Vidya Allgäu`],
	Allgaeu: [`Yoga Vidya Allgäu`],
	"Live Online": [`Online`],
};

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Yoga Vidya seminar listing${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);
		const urls = await fetchAllSeminarUrls({ limit: resolvedLimit });
		console.error(`Found ${urls.length} seminar URLs. Loading detail pages...`);
		const events = await collectSeminarPages({ urls });
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
				console.error(`Failed to process file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		return mapSeminarPage({ html, url });
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

/** Loads each seminar page on its own. A failure on one item does not stop the rest. */
export async function collectSeminarPages(args: {
	urls: string[];
	loadHtml?: (url: string) => Promise<string>;
	nowMs?: number;
}): Promise<ScrapedEvent[]> {
	const { urls, loadHtml = (url) => customFetch(url, { returnType: `text` }), nowMs = Date.now() } = args;
	const events: ScrapedEvent[] = [];
	let index = 0;
	let done = 0;
	let failed = 0;
	const { minMs, maxMs } = scrapeWindowBounds(nowMs);

	async function worker() {
		while (index < urls.length) {
			const current = index;
			index += 1;
			const url = urls[current];
			try {
				const html = await loadHtml(url);
				const event = mapSeminarPage({ html, url });
				if (!event) {
					failed += 1;
					console.error(`Skipping ${url}: missing name or start.`);
				} else if (!isInScrapeWindow(event.startAt, { minMs, maxMs })) {
					const startMs = Date.parse(event.startAt);
					if (startMs < minMs) {
						console.error(`Skipping past event ${event.name} (${event.startAt})`);
					} else {
						console.error(
							`Skipping event more than ${MAX_FUTURE_DAYS} days out ${event.name} (${event.startAt})`,
						);
					}
				} else {
					events.push(event);
				}
			} catch (error) {
				failed += 1;
				console.error(`Failed to process ${url}:`, error);
			}

			done += 1;
			if (done % 25 === 0 || done === urls.length) {
				console.error(`  details ${done}/${urls.length}`);
			}
		}
	}

	const workers = Math.min(DETAIL_CONCURRENCY, urls.length);
	if (workers > 0) {
		await Promise.all(Array.from({ length: workers }, () => worker()));
	}

	if (failed > 0) {
		console.error(`${failed} seminars could not be mapped.`);
	}

	events.sort((a, b) => a.startAt.localeCompare(b.startAt));
	return dedupeBySourceUrl(events);
}

export function mapSeminarPage(args: { html: string; url: string }): ScrapedEvent | undefined {
	const { html, url } = args;
	const name = getName(html);
	const startAt = getStartAt(html);
	const sourceUrl = getSourceUrl(html) || normalizeSeminarUrl(url);
	if (!name || !startAt || !sourceUrl) return undefined;

	const coords = getCoords(html);
	return {
		name,
		startAt,
		endAt: getEndAt(html),
		timezone: DEFAULT_TIMEZONE,
		address: getAddress(html),
		price: getPrice(html),
		priceIsHtml: false,
		description: getDescription(html),
		imageUrls: getImageUrls(html),
		host: getHost(html) || HOST_DEFAULT,
		hostLink: getHostLink(html),
		contact: [],
		latitude: coords?.lat ?? null,
		longitude: coords?.lng ?? null,
		tags: getTags(html),
		sourceUrl,
		source: SOURCE,
	};
}

export async function fetchAllSeminarUrls(args: {
	limit?: number;
	loadHtml?: (url: string) => Promise<string>;
	nowMs?: number;
} = {}): Promise<string[]> {
	const {
		limit,
		loadHtml = (url) => customFetch(url, { returnType: `text` }),
		nowMs = Date.now(),
	} = args;
	const { minMs, maxMs } = scrapeWindowBounds(nowMs);
	const urls: string[] = [];
	const seen = new Set<string>();
	let page = 1;
	/** Solr only shows a sliding window of page links — use as a hint, not a hard stop. */
	let hintedMaxPage = 1;

	while (true) {
		if (limit && urls.length >= limit) break;

		const pageUrl = page === 1 ? SEARCH_URL : `${SEARCH_URL}&tx_solr%5Bpage%5D=${page}`;
		let html: string;
		try {
			html = await loadHtml(pageUrl);
		} catch (error) {
			console.error(`Failed to fetch listing page ${page}:`, error);
			break;
		}

		hintedMaxPage = Math.max(hintedMaxPage, detectTotalPages(html));
		if (page === 1) {
			console.error(
				`  listing horizon: next ${MAX_FUTURE_DAYS} days (Solr page hint: ${hintedMaxPage}+)`,
			);
		}

		const entries = extractListingEntries(html);
		if (!entries?.length) {
			console.error(`  page ${page} — no seminar links, stopping`);
			break;
		}

		let added = 0;
		let skippedPast = 0;
		let skippedFuture = 0;
		let hitHorizon = false;

		for (const entry of entries) {
			if (entry.startMs != null) {
				if (entry.startMs < minMs) {
					skippedPast += 1;
					continue;
				}
				if (entry.startMs > maxMs) {
					skippedFuture += 1;
					hitHorizon = true;
					continue;
				}
			}

			if (seen.has(entry.url)) continue;
			seen.add(entry.url);
			urls.push(entry.url);
			added += 1;
			if (limit && urls.length >= limit) break;
		}

		console.error(
			`  page ${page} (hint ≤${hintedMaxPage}) — ${entries.length} links, ${added} new` +
				`${skippedPast ? `, ${skippedPast} past` : ``}` +
				`${skippedFuture ? `, ${skippedFuture} beyond ${MAX_FUTURE_DAYS}d` : ``}` +
				` (${urls.length} total)`,
		);

		if (limit && urls.length >= limit) break;
		// Listing is date-ascending; once we see dates past the horizon, later pages are further out.
		if (hitHorizon) {
			console.error(`  reached ${MAX_FUTURE_DAYS}-day horizon on page ${page}, stopping listing`);
			break;
		}
		page += 1;
	}

	return limit ? urls.slice(0, limit) : urls;
}

export function extractSeminarUrls(html: string): string[] {
	return extractListingEntries(html).map((entry) => entry.url);
}

/** Per-card listing rows with optional start day (Solr search results). */
export function extractListingEntries(html: string): { url: string; startMs?: number }[] {
	const $ = cheerio.load(html);
	const entries: { url: string; startMs?: number }[] = [];
	const seen = new Set<string>();

	const cards = $(`.seminar-search-item`).toArray();
	if (cards?.length) {
		for (const el of cards) {
			const href = ($(el).find(`a[href*="/seminare/seminar/"]`).first().attr(`href`) || ``).trim();
			const absolute = normalizeListingSeminarHref(href);
			if (!absolute || seen.has(absolute)) continue;
			seen.add(absolute);
			const range = parseDateRange($(el).text());
			entries.push({
				url: absolute,
				startMs: range ? ymdToUtcMs(range.start) : undefined,
			});
		}
		return entries;
	}

	// Fallback when card markup is missing.
	for (const el of $(`a[href*="/seminare/seminar/"]`).toArray()) {
		const absolute = normalizeListingSeminarHref(($(el).attr(`href`) || ``).trim());
		if (!absolute || seen.has(absolute)) continue;
		seen.add(absolute);
		entries.push({ url: absolute });
	}
	return entries;
}

function normalizeListingSeminarHref(href: string): string | undefined {
	if (!href || href.includes(`?`)) return undefined;
	const absolute = normalizeSeminarUrl(makeAbsoluteUrl(href, SITE_BASE) || href);
	if (!absolute) return undefined;
	if (/\/seminare\/seminar\/?$/.test(absolute)) return undefined;
	if (
		!/\/seminare\/seminar\/[^/]+\/?$/.test(absolute.replace(SITE_BASE, ``)) &&
		!absolute.includes(`/seminare/seminar/`)
	) {
		return undefined;
	}
	return absolute;
}

export function detectTotalPages(html: string): number {
	const pages = [
		...html.matchAll(/tx_solr(?:%5B|\[)page(?:%5D|\])=(\d+)/g),
	].map((match) => Number(match[1]));
	if (!pages?.length) return 1;
	return Math.max(1, ...pages);
}

export function scrapeWindowBounds(nowMs = Date.now()): { minMs: number; maxMs: number } {
	return {
		minMs: nowMs - PAST_GRACE_MS,
		maxMs: nowMs + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000,
	};
}

export function isInScrapeWindow(
	startAt: string,
	bounds: { minMs: number; maxMs: number } = scrapeWindowBounds(),
): boolean {
	const startMs = Date.parse(startAt);
	if (Number.isNaN(startMs)) return false;
	return startMs >= bounds.minMs && startMs <= bounds.maxMs;
}

function ymdToUtcMs(day: Ymd): number {
	return Date.UTC(day.year, day.month - 1, day.day);
}

function getName(html: string): string | undefined {
	const $ = cheerio.load(html);
	const h1 = superTrim($(`div.main h1.title, h1.title`).first().text());
	return h1 || undefined;
}

function getStartAt(html: string): string | undefined {
	const range = parseDateRange(getMeta(html, `Zeitraum`));
	if (!range) return undefined;
	const times = parseDayTimes(html);
	return toIso({
		day: range.start,
		hour: times?.startHour ?? 0,
		minute: times?.startMinute ?? 0,
	});
}

function getEndAt(html: string): string | undefined {
	const range = parseDateRange(getMeta(html, `Zeitraum`));
	if (!range) return undefined;
	const times = parseDayTimes(html);
	const endDay = range.end ?? range.start;
	const sameDay = !range.end || sameYmd(range.start, range.end);
	if (sameDay && times) {
		return toIso({
			day: endDay,
			hour: times.endHour,
			minute: times.endMinute,
		});
	}
	if (sameDay && !times) return undefined;
	return toIso({
		day: endDay,
		hour: times?.endHour ?? 0,
		minute: times?.endMinute ?? 0,
	});
}

function getAddress(html: string): string[] {
	const ort = getMeta(html, `Ort`);
	if (ort && /live\s*online|online/i.test(ort)) return [`Online`];

	const mapAddress = getMapAddress(html);
	if (mapAddress && looksLikeStreetAddress(mapAddress)) {
		return splitAddress(mapAddress);
	}

	if (ort && VENUE_BY_ORT[ort]) return [...VENUE_BY_ORT[ort]];

	if (mapAddress) {
		const lines = splitAddress(mapAddress);
		if (ort && !lines.some((line) => line.toLowerCase().includes(ort.toLowerCase()))) {
			lines.push(ort);
		}
		return lines;
	}

	if (ort) return [`Yoga Vidya ${ort}`, ort];
	return [`Yoga Vidya`];
}

function getPrice(html: string): string | undefined {
	const $ = cheerio.load(html);
	const fromStrong = superTrim(
		$(`span.icon-text`)
			.filter((_, el) => $(el).find(`[title="Preis"]`).length > 0)
			.first()
			.find(`strong`)
			.first()
			.text(),
	);
	const raw =
		fromStrong ||
		superTrim($(`#seminar-submit-box`).text().match(/ab\s*(€\s*[\d.,]+)/i)?.[1]) ||
		getMeta(html, `Preis`);
	if (!raw || raw === `ab`) return undefined;

	const amountMatch = raw.replace(/\s+/g, ` `).match(/€\s*([\d.,]+)|([\d.,]+)\s*€/);
	if (!amountMatch) return superTrim(raw);

	const amount = (amountMatch[1] || amountMatch[2] || ``).replace(/\./g, ``).replace(`,`, `.`);
	const value = Number(amount);
	if (!Number.isFinite(value)) return superTrim(raw);
	if (value === 0) return `Kostenlos`;

	const formatted = Number.isInteger(value)
		? String(value)
		: value.toFixed(2).replace(`.`, `,`);
	const isFrom = /ab/i.test(raw) || /ab/i.test(getMeta(html, `Preis`) || ``) ||
		$(`#seminar-submit-box`).text().includes(`ab`);
	return isFrom ? `ab ${formatted}€` : `${formatted}€`;
}

function getDescription(html: string): string | undefined {
	const $ = cheerio.load(html);
	const $main = $(`div.main`).first();
	const parts: string[] = [];

	// Short intro under the title (first category-description in main).
	const $intro = $main.find(`.category-description`).first().clone();
	if ($intro?.length) {
		$intro.find(`script, style`).remove();
		$intro.find(`.description-small`).remove();
		$intro.find(`.description-large`).removeClass(`is-hidden`);
		const introHtml = $intro.html()?.trim();
		if (introHtml) parts.push(introHtml);
	}

	// Extra narrative blocks in main ("Dein Tag bei uns", …) until venue / teachers / price.
	for (const el of $main.children(`.content`).toArray()) {
		const $block = $(el);
		if ($block.find(`h1`).length) continue;
		const heading = superTrim($block.find(`h2, h3`).first().text()) || ``;
		if (!heading) continue;
		if (DESCRIPTION_STOP_HEADING.test(heading)) break;

		const clone = $block.clone();
		clone.find(`script, style, iframe, .icon-text, .seminar-category`).remove();
		clone.find(`.description-small`).remove();
		clone.find(`.description-large`).removeClass(`is-hidden`);
		const blockHtml = clone.html()?.trim();
		if (blockHtml) parts.push(blockHtml);
	}

	// Tagesablauf lives in the accordion beside/below main, not inside div.main.
	const $daily = $(`#daily_plan`).clone();
	if ($daily?.length) {
		$daily.find(`script, style`).remove();
		const dailyHtml = $daily.html()?.trim();
		const dailyText = superTrim($daily.text());
		if (dailyHtml && dailyText && !parts.some((part) => part.includes(dailyText.slice(0, 40)))) {
			parts.push(`<h3>Tagesablauf</h3>\n${dailyHtml}`);
		}
	}

	if (!parts?.length) return undefined;
	return cleanProseHtml(parts.join(`\n`)) || undefined;
}

const DESCRIPTION_STOP_HEADING =
	/^(lehrende|preise|zimmer|yoga ashram|yoga vidya|ashram|besonderheiten|anreise|voraussetzungen|hinweise)/i;

function getImageUrls(html: string): string[] {
	const $ = cheerio.load(html);
	const urls: string[] = [];
	const seen = new Set<string>();

	const push = (raw: string | undefined) => {
		const absolute = makeAbsoluteUrl(raw?.trim(), SITE_BASE);
		if (!absolute || seen.has(absolute)) return;
		if (absolute.includes(`30_Jahre_Yoga_Vidya`)) return;
		if (absolute.includes(`/typo3conf/`)) return;
		seen.add(absolute);
		urls.push(absolute);
	};

	push($(`meta[property="og:image"]`).attr(`content`));
	for (const el of $(`div.main a.fullsize-image-modal`).toArray().slice(0, 3)) {
		push($(el).attr(`href`));
	}
	for (const el of $(`div.main .seminar-category img, div.main img.card-img-top`).toArray().slice(0, 2)) {
		push($(el).attr(`src`));
	}

	return urls;
}

function getHost(html: string): string | undefined {
	const $ = cheerio.load(html);
	const $main = $(`div.main`).first();
	const $teachers = $main.find(`h2`).filter((_, el) => /lehrende/i.test($(el).text())).first();
	if ($teachers.length) {
		const name =
			superTrim($teachers.nextAll(`.seminar-category`).first().find(`h3.title, h3`).first().text()) ||
			superTrim($teachers.nextAll().find(`h3.title, h3`).first().text());
		if (name && !/^yoga ashram/i.test(name)) return name;
	}

	const $leiter = $main.find(`a[href*="/seminare/leiter/"]`).first();
	const linkText = superTrim($leiter.closest(`.seminar-category, .content`).find(`h3`).first().text());
	return linkText && !/^yoga ashram/i.test(linkText) ? linkText : undefined;
}

function getHostLink(html: string): string | undefined {
	const $ = cheerio.load(html);
	const href = $(`div.main a[href*="/seminare/leiter/"]`).first().attr(`href`)?.trim();
	return makeAbsoluteUrl(href, SITE_BASE) || undefined;
}

function getTags(html: string): string[] {
	const $ = cheerio.load(html);
	const tags: string[] = [];
	const seen = new Set<string>();

	const push = (raw: string | undefined) => {
		const tag = superTrim(raw);
		if (!tag) return;
		const key = tag.toLowerCase();
		if (seen.has(key)) return;
		if (/yoga vidya e\.?v\.?/i.test(tag)) return;
		seen.add(key);
		tags.push(tag);
	};

	for (const el of $(`#seminar-submit-box a[href*="interessengebiet"], #seminar-submit-box-w a[href*="interessengebiet"], a[href*="/seminare/interessengebiet/"]`).toArray()) {
		push($(el).text());
	}

	return tags;
}

function getSourceUrl(html: string): string | undefined {
	const $ = cheerio.load(html);
	const og = $(`meta[property="og:url"]`).attr(`content`)?.trim();
	if (og) return normalizeSeminarUrl(og);
	const canonical = $(`link[rel="canonical"]`).attr(`href`)?.trim();
	return canonical ? normalizeSeminarUrl(canonical) : undefined;
}

function getCoords(html: string): { lat: number; lng: number } | undefined {
	const match = html.match(/1m3!1d[^!]+!2d([0-9.-]+)!3d([0-9.-]+)/);
	if (!match) return undefined;
	const lng = Number(match[1]);
	const lat = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
	if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return undefined;
	return { lat, lng };
}

function getMapAddress(html: string): string | undefined {
	const match = html.match(/!2s([^!]+)!/);
	if (!match) return undefined;
	const decoded = decodeURIComponent(match[1].replace(/\+/g, ` `)).trim();
	if (!decoded || decoded.length < 3) return undefined;
	if (/^(de|deutschland|germany)$/i.test(decoded)) return undefined;
	return decoded;
}

function getMeta(html: string, title: `Zeitraum` | `Ort` | `Seminar-Nr` | `Preis`): string | undefined {
	const $ = cheerio.load(html);
	const $main = $(`div.main`).first();
	const $root = $main.length ? $main : $.root();
	const values: string[] = [];

	for (const el of $root.find(`span.icon-text`).toArray()) {
		const $el = $(el);
		if (!$el.find(`[title="${title}"]`).length) continue;
		// Value is the text of the icon-text minus the icon glyph title noise.
		const clone = $el.clone();
		clone.find(`.icon`).remove();
		const text = superTrim(clone.text());
		if (text) values.push(text);
	}

	if (!values?.length) return undefined;
	// Prefer the richest Zeitraum (range) / Preis (with euro amount).
	if (title === `Zeitraum`) {
		return values.find((value) => value.includes(`-`)) || values[0];
	}
	if (title === `Preis`) {
		return values.find((value) => /€|\d/.test(value)) || values[0];
	}
	if (title === `Ort`) {
		return values.find((value) => !/^[A-Z]\d{6}/.test(value) && !/facebook|instagram/i.test(value)) ||
			values[0];
	}
	return values[0];
}

export function parseDateRange(raw: string | undefined): {
	start: Ymd;
	end?: Ymd;
} | undefined {
	if (!raw) return undefined;
	const match = raw.match(
		/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*(?:-|–|—)\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,
	);
	if (match) {
		return {
			start: ymd(Number(match[3]), Number(match[2]), Number(match[1])),
			end: ymd(Number(match[6]), Number(match[5]), Number(match[4])),
		};
	}

	const single = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
	if (!single) return undefined;
	return { start: ymd(Number(single[3]), Number(single[2]), Number(single[1])) };
}

function parseDayTimes(html: string): {
	startHour: number;
	startMinute: number;
	endHour: number;
	endMinute: number;
} | undefined {
	const $ = cheerio.load(html);
	const $main = $(`div.main`).first();
	const blob =
		superTrim($main.find(`.category-description`).first().text()) ||
		superTrim($main.find(`#daily_plan`).text()) ||
		``;
	const match = blob.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
	if (!match) return undefined;
	return {
		startHour: Number(match[1]),
		startMinute: Number(match[2]),
		endHour: Number(match[3]),
		endMinute: Number(match[4]),
	};
}

function toIso(args: { day: Ymd; hour: number; minute: number }): string {
	const { day, hour, minute } = args;
	return dateToIsoStr(day.year, day.month, day.day, hour, minute, DEFAULT_TIMEZONE, false);
}

function ymd(year: number, month: number, day: number): Ymd {
	return {
		year: year < 100 ? 2000 + year : year,
		month,
		day,
	};
}

function sameYmd(a: Ymd, b: Ymd) {
	return a.year === b.year && a.month === b.month && a.day === b.day;
}

function looksLikeStreetAddress(value: string) {
	return /\d/.test(value) && /,/.test(value);
}

function splitAddress(value: string): string[] {
	return value
		.split(`,`)
		.map((part) => superTrim(part))
		.filter((part): part is string => !!part);
}

function normalizeSeminarUrl(url: string): string {
	try {
		const parsed = new URL(url, SITE_BASE);
		parsed.hash = ``;
		let path = parsed.pathname;
		if (!path.endsWith(`/`)) path += `/`;
		return `${parsed.origin}${path}`;
	} catch {
		return url.trim();
	}
}

function dedupeBySourceUrl(events: ScrapedEvent[]): ScrapedEvent[] {
	const seen = new Set<string>();
	return events.filter((event) => {
		if (seen.has(event.sourceUrl)) return false;
		seen.add(event.sourceUrl);
		return true;
	});
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number } {
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
		// Ignore runner flags (`--clean`, `--dry-run`, …) and other unknowns.
		if (arg.startsWith(`-`)) continue;
	}

	return { limit };
}

function parseLimitValue(raw: string | undefined): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit value: ${raw}`);
	return Math.floor(parsed);
}

function inferFileUrl(filePath: string): string {
	const match = filePath.match(/seminare\/seminar\/[^/]+/);
	if (match) return `${SITE_BASE}/${match[0]}/`;
	return `${SITE_BASE}/seminare/seminar/local-file/`;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

if (import.meta.main) {
	try {
		const { limit } = parseCliArgs();
		const events = await new WebsiteScraper().scrapeWebsite(limit);
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type Ymd = { year: number; month: number; day: number };
