/**
 * Scrapes upcoming events from dein-kayana.de.
 *
 * Prefer WordPress REST (`/wp-json/wp/v2/posts?categories=1`) for listing +
 * description. Breakdance listing HTML fills host / date / time / images
 * (custom template fields are not exposed on the REST post).
 *
 * Usage:
 *   bun run scripts/scrape-kayana.ts
 *   bun run scripts/scrape-kayana.ts --limit 10
 *   bun run scripts/scrape-kayana.ts --limit=10
 *   bun run scripts/scrape-kayana.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	sleep,
	superTrim,
	REQUEST_DELAY_MS,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://dein-kayana.de`;
const LISTING_URL = `${SITE_BASE}/veranstaltungen-im-kayana/`;
const POSTS_API = `${SITE_BASE}/wp-json/wp/v2/posts`;
/** Category "Veranstaltungen" — only category on the site. */
const EVENTS_CATEGORY_ID = 1;
const SOURCE = `kayana` as const;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const VENUE_ADDRESS = [`Kayana`, `Berwicker Straße 26`, `59514 Welver`] as const;
const SITE_CONTACT = [`https://t.me/deinkayana`, `klara@dein-kayana.de`] as const;
const PAST_GRACE_MS = 12 * 60 * 60 * 1000;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching Kayana events via WP REST + listing${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let posts: WpPost[];
		try {
			posts = await fetchAllWpPosts();
		} catch (error) {
			console.error(`Failed to fetch WP posts:`, error);
			return [];
		}
		console.error(`WP REST returned ${posts.length} posts in category Veranstaltungen.`);

		let listingHtml: string;
		try {
			listingHtml = await customFetch(LISTING_URL, { returnType: `text` });
		} catch (error) {
			console.error(`Failed to fetch listing HTML:`, error);
			return [];
		}

		const cards = extractListingCards(listingHtml);
		console.error(`Listing HTML yielded ${cards.length} event cards.`);

		const postsByUrl = new Map(posts.map((post) => [normalizeUrl(post.link), post]));
		const cardUrls = cards.map((card) => card.url);
		const urls = resolvedLimit ? cardUrls.slice(0, resolvedLimit) : cardUrls;

		const venueCoords = await geocodeVenue();
		const events: ScrapedEvent[] = [];

		for (const url of urls) {
			try {
				const card = cards.find((c) => c.url === url);
				const post = postsByUrl.get(normalizeUrl(url));
				const event = await mapKayanaEvent({
					url,
					card,
					post,
					venueCoords,
				});
				if (event) events.push(event);
			} catch (error) {
				console.error(`Failed to process ${url}:`, error);
			}
		}

		// REST-only posts missing from the listing (shouldn't happen, but don't drop them).
		if (!resolvedLimit) {
			for (const post of posts) {
				const url = normalizeUrl(post.link);
				if (cardUrls.includes(url)) continue;
				try {
					const event = await mapKayanaEvent({ url, post, venueCoords });
					if (event) events.push(event);
				} catch (error) {
					console.error(`Failed to process REST-only post ${url}:`, error);
				}
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
		const events: ScrapedEvent[] = [];
		const venueCoords = await geocodeVenue();
		for (const filePath of filePaths) {
			try {
				const html = await Bun.file(filePath).text();
				const url = inferFileUrl(filePath);
				const event = await this.extractEventData(html, url, venueCoords);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error);
			}
		}
		return events;
	}

	async extractEventData(
		html: string,
		url: string,
		venueCoords?: VenueCoords,
	): Promise<ScrapedEvent | undefined> {
		try {
			return await mapKayanaEvent({
				url,
				detailHtml: html,
				venueCoords: venueCoords ?? (await geocodeVenue()),
			});
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		return getName({ detailHtml: html });
	}
	extractStartAt(html: string): string | undefined {
		return getStartAt({ detailHtml: html });
	}
	extractEndAt(html: string): string | undefined {
		return getEndAt({ detailHtml: html });
	}
	extractAddress(_html: string): string[] | undefined {
		return getAddress();
	}
	extractPrice(html: string): string | undefined {
		return getPrice({ detailHtml: html });
	}
	extractDescription(html: string): string | undefined {
		return getDescription({ detailHtml: html });
	}
	extractImageUrls(html: string): string[] | undefined {
		return getImageUrls({ detailHtml: html });
	}
	extractHost(html: string): string | undefined {
		return getHost({ detailHtml: html });
	}
	extractHostLink(_html: string): string | undefined {
		return undefined;
	}
	extractTags(_html: string): string[] | undefined {
		return [];
	}
	extractContact(html: string): string[] | undefined {
		return getContact({ detailHtml: html });
	}
}

export async function mapKayanaEvent(args: {
	url: string;
	card?: ListingCard;
	post?: WpPost;
	detailHtml?: string;
	venueCoords?: VenueCoords;
}): Promise<ScrapedEvent | undefined> {
	const { url, card, post, detailHtml, venueCoords } = args;
	const data: KayanaEventData = { url, card, post, detailHtml };

	const name = getName(data);
	const startAt = getStartAt(data);
	const sourceUrl = normalizeUrl(url);
	if (!name || !startAt || !sourceUrl) {
		console.error(`Skipping ${url} due to missing name, start, or sourceUrl.`);
		return undefined;
	}

	const endAt = getEndAt(data);
	if (!isUpcoming({ startAt, endAt })) {
		console.error(`Skipping past event ${sourceUrl}`);
		return undefined;
	}

	return {
		name,
		startAt,
		endAt,
		timezone: venueCoords?.timezone ?? DEFAULT_TIMEZONE,
		address: getAddress(),
		price: getPrice(data),
		priceIsHtml: false,
		description: getDescription(data),
		imageUrls: getImageUrls(data),
		host: getHost(data),
		hostLink: undefined,
		contact: getContact(data),
		latitude: venueCoords?.lat ?? null,
		longitude: venueCoords?.lng ?? null,
		tags: [],
		sourceUrl,
		source: SOURCE,
	} satisfies ScrapedEvent;
}

export function extractListingCards(html: string): ListingCard[] {
	const $ = cheerio.load(html);
	const cards: ListingCard[] = [];
	const seen = new Set<string>();

	$(`article.bde-loop-item`).each((_i, el) => {
		try {
			const $article = $(el);
			const href =
				$article.find(`a.bde-container-link[href]`).first().attr(`href`) ||
				$article.find(`a[href*="dein-kayana.de"]`).first().attr(`href`);
			if (!href) return;
			const url = normalizeUrl(makeAbsoluteUrl(href, SITE_BASE) ?? href);
			if (!url || seen.has(url)) return;
			if (url.includes(`/veranstaltungen-im-kayana`)) return;

			const titleTexts = $article
				.find(`[class*="bde-text-"]`)
				.toArray()
				.map((node) => superTrim($(node).text()))
				.filter((text): text is string => Boolean(text) && text !== `Info`);

			const listTexts = $article
				.find(`.bde-icon-list__text`)
				.toArray()
				.map((node) => superTrim($(node).text()))
				.filter((text): text is string => Boolean(text));

			// Listing CSS paints organizer first, event second — flip for cover-first.
			const imageUrls = extractBackgroundImages($article.html() ?? ``).reverse();

			const dateText = listTexts.find((text) => /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(text));
			const timeText = listTexts.find((text) => /\d{1,2}(?::\d{2})?\s*(?:-|–|—)?\s*\d{0,2}(?::\d{2})?\s*Uhr/i.test(text));
			const host = listTexts.find((text) => text !== dateText && text !== timeText);

			seen.add(url);
			cards.push({
				url,
				name: titleTexts[0],
				subtitle: titleTexts[1],
				host,
				dateText,
				timeText,
				imageUrls,
				articleHtml: $.html(el),
			});
		} catch (error) {
			console.error(`Failed to parse listing card:`, error);
		}
	});

	return cards;
}

export function getName(data: KayanaEventData): string | undefined {
	// WP titles are fuller ("Stricken am Kaminfeuer"); listing cards often shorten.
	const rawTitle = data.post?.title?.rendered;
	if (rawTitle) {
		const title = decodeHtmlEntities(rawTitle);
		const stripped = superTrim(
			title.replace(/\s+(?:am\s+)?\d{1,2}\.\d{1,2}\.\d{2,4}\s*$/i, ``),
		);
		if (stripped) return stripped;
	}

	if (data.card?.name) {
		const name = decodeHtmlEntities(data.card.name);
		const subtitle = data.card.subtitle ? decodeHtmlEntities(data.card.subtitle) : undefined;
		// "Stricken" + "am Kaminfeuer" → keep readable single line when subtitle continues the title
		if (subtitle && /^am\s/i.test(subtitle)) return `${name} ${subtitle}`;
		return name;
	}

	if (data.detailHtml) {
		const $ = cheerio.load(data.detailHtml);
		const h1 = superTrim($(`h1.bde-heading, h1`).first().text());
		if (h1) return decodeHtmlEntities(h1);
	}

	return undefined;
}

export function getStartAt(data: KayanaEventData): string | undefined {
	const fromCard = parseGermanDateAndTime({
		dateText: data.card?.dateText,
		timeText: data.card?.timeText,
		prefer: `start`,
	});
	if (fromCard) return fromCard;

	if (data.detailHtml) {
		const parsed = parseDetailDateTime(data.detailHtml);
		if (parsed?.startAt) return parsed.startAt;
	}

	const title = data.post?.title?.rendered ? decodeHtmlEntities(data.post.title.rendered) : undefined;
	const titleDate = title?.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/)?.[1];
	if (titleDate) return parseGermanDateAndTime({ dateText: titleDate, prefer: `start` });

	return undefined;
}

export function getEndAt(data: KayanaEventData): string | undefined {
	const fromCard = parseGermanDateAndTime({
		dateText: data.card?.dateText,
		timeText: data.card?.timeText,
		prefer: `end`,
	});
	if (fromCard) return fromCard;

	if (data.detailHtml) {
		const parsed = parseDetailDateTime(data.detailHtml);
		if (parsed?.endAt) return parsed.endAt;
	}

	return undefined;
}

export function getAddress(): string[] {
	return [...VENUE_ADDRESS];
}

export function getPrice(data: KayanaEventData): string | undefined {
	const text = descriptionPlainText(data);
	if (!text) return undefined;

	const recommendation = text.match(
		/(?:Spendenempfehlung|Empfohlene Spende|Wertschätzungsbeitrag|Spende ab)\s*:?\s*([0-9][0-9.,\s–\-bis]*\s*€)/i,
	);
	if (recommendation?.[1]) return superTrim(recommendation[1].replace(/\s+/g, ` `));

	if (/Eintritt ist frei|ist kostenlos|kostenlos\b/i.test(text)) return `Eintritt frei`;
	if (/auf Spendenbasis|über eine Spende|freue .* Spende/i.test(text)) return `Spendenbasis`;

	const euro = text.match(/\b\d{1,3}(?:[.,]\d{2})?\s*€/);
	if (euro?.[0]) return superTrim(euro[0]);

	return undefined;
}

export function getDescription(data: KayanaEventData): string | undefined {
	if (data.post?.content?.rendered) {
		return cleanProseHtml(data.post.content.rendered) || undefined;
	}
	if (data.detailHtml) {
		const $ = cheerio.load(data.detailHtml);
		const paragraphs = $(`.wp-block-paragraph`)
			.toArray()
			.map((el) => $.html(el))
			.join(`\n`);
		return cleanProseHtml(paragraphs) || undefined;
	}
	return undefined;
}

export function getImageUrls(data: KayanaEventData): string[] {
	const urls: string[] = [];
	const push = (raw: string | undefined) => {
		if (!raw) return;
		const absolute = makeAbsoluteUrl(raw, SITE_BASE) ?? raw;
		if (!absolute.startsWith(`http`)) return;
		if (/logo|favicon|sprite|icon/i.test(absolute)) return;
		if (urls.includes(absolute)) return;
		urls.push(absolute);
	};

	for (const url of data.card?.imageUrls ?? []) push(url);

	if (data.detailHtml) {
		for (const url of extractBackgroundImages(data.detailHtml)) push(url);
		const $ = cheerio.load(data.detailHtml);
		$(`img[src]`).each((_i, el) => push($(el).attr(`src`)));
	}

	return urls;
}

export function getHost(data: KayanaEventData): string | undefined {
	if (data.card?.host) return decodeHtmlEntities(data.card.host);

	if (data.detailHtml) {
		const $ = cheerio.load(data.detailHtml);
		const texts = $(`[class*="bde-text-"]`)
			.toArray()
			.map((el) => superTrim($(el).text()))
			.filter((text): text is string => Boolean(text));
		const zeitIdx = texts.findIndex((text) => /^Zeit mit$/i.test(text));
		if (zeitIdx >= 0 && texts[zeitIdx + 1]) return decodeHtmlEntities(texts[zeitIdx + 1]);

		const hostBlock = superTrim($(`.bde-text-70-186`).first().text());
		if (hostBlock) return decodeHtmlEntities(hostBlock);
	}

	const author = data.post?._embedded?.author?.[0]?.name;
	if (author && author.toLowerCase() !== `admin`) return author;
	return undefined;
}

export function getContact(data: KayanaEventData): string[] {
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

	// Only scan prose — listing/detail chrome includes SVG path data that looks like phones.
	const haystacks = [data.post?.content?.rendered, data.detailHtml]
		.filter(Boolean)
		.map((html) => cheerio.load(html as string).root().text());

	for (const haystack of haystacks) {
		for (const email of haystack.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
			if (/awesome-menu|breakdance|wp-content|example\.com/i.test(email)) continue;
			push(email);
		}
		for (const tel of haystack.match(/(?:\+|00)?(?:49\s*)?(?:\(?0\)?\s*)?\d(?:[\s./-]?\d){6,}/g) ?? []) {
			const digits = tel.replace(/\D/g, ``);
			if (digits.length < 8 || digits.length > 15) continue;
			// Reject SVG/viewBox leftovers like "0 0 448 512".
			if (/^0+$/.test(digits) || !/[1-9]/.test(digits.slice(0, 3))) continue;
			push(tel.replace(/\s+/g, ` `).trim());
		}
	}

	for (const fallback of SITE_CONTACT) push(fallback);
	return contacts;
}

export function parseCliArgs(argv = process.argv.slice(2)): { limit?: number; files: string[] } {
	let limit: number | undefined;
	const files: string[] = [];

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
		if (arg.startsWith(`-`)) {
			if (arg === `--log-dir` || arg === `--exclude`) i++;
			continue;
		}
		files.push(arg);
	}

	return { limit, files };
}

async function fetchAllWpPosts(): Promise<WpPost[]> {
	const posts: WpPost[] = [];
	let page = 1;
	const perPage = 100;

	while (true) {
		const url = `${POSTS_API}?categories=${EVENTS_CATEGORY_ID}&per_page=${perPage}&page=${page}&_embed=1`;
		const batch = await customFetch(url, { returnType: `json` });
		if (!Array.isArray(batch) || !batch.length) break;
		posts.push(...(batch as WpPost[]));
		if (batch.length < perPage) break;
		page += 1;
		await sleep(REQUEST_DELAY_MS);
	}

	return posts;
}

async function geocodeVenue(): Promise<VenueCoords | undefined> {
	try {
		const geocoded = await geocodeAddressCached({
			addressLines: [...VENUE_ADDRESS],
			apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
		});
		if (!geocoded) return undefined;
		return {
			lat: geocoded.lat,
			lng: geocoded.lng,
			timezone: geocoded.timezone ?? DEFAULT_TIMEZONE,
		};
	} catch (error) {
		console.error(`Geocoding Kayana venue failed:`, error);
		return undefined;
	}
}

function parseDetailDateTime(html: string): { startAt?: string; endAt?: string } | undefined {
	const $ = cheerio.load(html);
	const texts = $(`[class*="bde-text-"]`)
		.toArray()
		.map((el) => superTrim($(el).text()))
		.filter((text): text is string => Boolean(text));

	const dateText = texts.find((text) => /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(text));
	const timeIdx = texts.findIndex((text) => text === `um`);
	const timeText =
		timeIdx >= 0
			? texts.slice(timeIdx + 1).find((text) => /\d/.test(text) && text !== `Uhr`)
			: texts.find((text) => /\d{1,2}(?::\d{2})?/.test(text) && /-|–|\d{2}/.test(text));

	if (!dateText) return undefined;
	return {
		startAt: parseGermanDateAndTime({ dateText, timeText, prefer: `start` }),
		endAt: parseGermanDateAndTime({ dateText, timeText, prefer: `end` }),
	};
}

function parseGermanDateAndTime(args: {
	dateText?: string;
	timeText?: string;
	prefer: `start` | `end`;
}): string | undefined {
	const dateMatch = args.dateText?.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
	if (!dateMatch) return undefined;

	const day = Number(dateMatch[1]);
	const month = Number(dateMatch[2]);
	let year = Number(dateMatch[3]);
	if (year < 100) year += 2000;

	const times = extractTimes(args.timeText);
	if (args.prefer === `end`) {
		if (times.length < 2) return undefined;
		const [, end] = times;
		return dateToIsoStr(year, month - 1, day, end.hour, end.minute, DEFAULT_TIMEZONE, true);
	}

	const start = times[0] ?? { hour: 0, minute: 0 };
	return dateToIsoStr(year, month - 1, day, start.hour, start.minute, DEFAULT_TIMEZONE, true);
}

function extractTimes(timeText: string | undefined): { hour: number; minute: number }[] {
	if (!timeText) return [];
	const cleaned = timeText.replace(/Uhr/gi, ` `).replace(/[–—]/g, `-`);
	// Accept `17:00`, `14.00`, and bare hours in ranges like `17 - 19`.
	const matches = [...cleaned.matchAll(/(\d{1,2})(?:[:.](\d{2}))?/g)];
	return matches.map((match) => ({
		hour: Number(match[1]),
		minute: match[2] != null ? Number(match[2]) : 0,
	}));
}

function extractBackgroundImages(html: string): string[] {
	const urls: string[] = [];
	for (const match of html.matchAll(/background-image:\s*url\(([^)]+)\)/gi)) {
		const raw = match[1].replace(/^['"]|['"]$/g, ``).trim();
		if (!raw || /logo|favicon/i.test(raw)) continue;
		const absolute = makeAbsoluteUrl(raw, SITE_BASE) ?? raw;
		if (!urls.includes(absolute)) urls.push(absolute);
	}
	return urls;
}

function descriptionPlainText(data: KayanaEventData): string | undefined {
	const html = data.post?.content?.rendered ?? data.detailHtml;
	if (!html) return undefined;
	const $ = cheerio.load(html);
	return superTrim($(`body`).text() || $.root().text());
}

function isUpcoming({ startAt, endAt }: { startAt: string; endAt?: string }): boolean {
	const endMs = endAt ? new Date(endAt).getTime() : new Date(startAt).getTime();
	return endMs + PAST_GRACE_MS >= Date.now();
}

function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url, SITE_BASE);
		parsed.hash = ``;
		parsed.search = ``;
		let path = parsed.pathname;
		if (!path.endsWith(`/`)) path += `/`;
		return `${parsed.origin}${path}`;
	} catch {
		return url;
	}
}

function decodeHtmlEntities(value: string): string {
	return cheerio.load(`<textarea>${value}</textarea>`)(`textarea`).text();
}

function inferFileUrl(filePath: string): string {
	const base = filePath.split(`/`).pop()?.replace(/\.html?$/i, ``) ?? `unknown`;
	return `${SITE_BASE}/${base}/`;
}

function parseLimitValue(raw: string | undefined): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit value: ${raw}`);
	return Math.floor(parsed);
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

type WpPost = {
	id: number;
	link: string;
	title?: { rendered?: string };
	content?: { rendered?: string };
	_embedded?: {
		author?: { name?: string }[];
	};
};

type ListingCard = {
	url: string;
	name?: string;
	subtitle?: string;
	host?: string;
	dateText?: string;
	timeText?: string;
	imageUrls: string[];
	articleHtml: string;
};

type KayanaEventData = {
	url: string;
	card?: ListingCard;
	post?: WpPost;
	detailHtml?: string;
};

type VenueCoords = {
	lat: number;
	lng: number;
	timezone: string;
};
