/**
 * Scrapes ticketed / special events from The Yoga Barn upcoming event calendar.
 *
 * Calendar listing (same source as the website month picker):
 *   GET theyogabarn.com/wp-admin/admin-ajax.php?action=event_onmonth&eventDate=D/M/YYYY
 *
 * Enrichment:
 *   GET theyogabarn.com/wp-json/wp/v2/event — fallback descriptions / posters
 *   GET megatix.co.id/api/v2/events/{slug}  — cover, description, dates, tickets
 *     (white-label booking links are rewritten to /events/{slug})
 *
 * When a Megatix link exists:
 *   sourceUrl → https://megatix.co.id/events/{slug}
 *   image/description/dates/price prefer Megatix payload
 *
 * Usage:
 *   bun run scripts/scrape-yogabarn.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import * as cheerio from "cheerio";

const SITE_BASE = `https://theyogabarn.com`;
const WP_EVENTS_API = `${SITE_BASE}/wp-json/wp/v2/event`;
const CALENDAR_AJAX = `${SITE_BASE}/wp-admin/admin-ajax.php`;
const CALENDAR_PAGE = `${SITE_BASE}/upcoming-event-calendar/`;
const MEGATIX_BASE = `https://megatix.co.id`;
const TIMEZONE = `Asia/Makassar`;
const MONTHS_AHEAD = 4;

const VENUE_ADDRESS = [
	`The Yoga Barn`,
	`Jl. Sukma Kesuma, Peliatan`,
	`Ubud, Bali 80571`,
] as const;
const LATITUDE = -8.519896632767638;
const LONGITUDE = 115.26575145920715;
const CONTACT = [`https://api.whatsapp.com/send?phone=628113983789`, SITE_BASE];

const FOOTER_IMAGE_MARKERS = [
	`melukat`,
	`agnihotra`,
	`mala.png`,
	`sound-healing.png`,
	`garden-cafe`,
	`sukma-yoga`,
	`ryt-yoga-alliance`,
	`logo_theyogabarn`,
	`cropped-cropped-Image_Editor`,
];
const MIN_IMAGE_BYTES = 10 * 1024;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		console.error(`Fetching calendar months via event_onmonth…`);
		const cards = await this.fetchCalendarCardsAhead(MONTHS_AHEAD);
		console.error(`  calendar cards: ${cards.length}`);

		console.error(`Fetching WP event descriptions…`);
		const wpBySlug = await this.fetchWpEventsBySlug();
		console.error(`  WP events indexed: ${wpBySlug.size}`);

		const megatixUrls = [
			...new Set(
				cards
					.flatMap((c) => {
						const wp = c.slug ? wpBySlug.get(c.slug) : undefined;
						return [c.megatixUrl, wp?.megatixUrls[0]];
					})
					.filter((u): u is string => !!u),
			),
		];
		console.error(`Fetching Megatix event pages (${megatixUrls.length})…`);
		const megatixBySlug = await this.fetchMegatixEventsByUrls(megatixUrls);
		console.error(`  megatix events resolved: ${megatixBySlug.size}/${megatixUrls.length}`);

		const events: ScrapedEvent[] = [];
		const seen = new Set<string>();
		const nowMs = Date.now() - 6 * 60 * 60 * 1000;
		const imageSizeCache = new Map<string, number | undefined>();

		for (const card of cards) {
			try {
				const event = this.cardToEvent({ card, wpBySlug, megatixBySlug });
				if (!event) continue;
				if (Date.parse(event.startAt) < nowMs) continue;
				const dedupeKey = `${normalizeKey(event.name)}|${event.startAt}`;
				if (seen.has(dedupeKey)) continue;

				event.imageUrls = await filterImagesByMinBytes({
					urls: event.imageUrls,
					minBytes: MIN_IMAGE_BYTES,
					sizeCache: imageSizeCache,
				});
				if (!event.imageUrls.length) {
					console.error(`Skipping ${event.name}: no images >= ${MIN_IMAGE_BYTES / 1024}kb`);
					continue;
				}

				seen.add(dedupeKey);
				events.push(event);
			} catch (error) {
				console.error(`Failed to map calendar card ${card.title}:`, error);
			}
		}

		events.sort((a, b) => a.startAt.localeCompare(b.startAt));
		console.error(`--- Scraping finished. Total events: ${events.length} ---`);
		return events;
	}

	async scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		throw new Error(`Method not implemented.` + html + url);
	}

	extractName(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractStartAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractEndAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractAddress(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractPrice(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractDescription(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractImageUrls(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHost(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHostLink(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractTags(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}

	private cardToEvent(args: {
		card: CalendarCard;
		wpBySlug: Map<string, WpEventPoster>;
		megatixBySlug: Map<string, MegatixEvent>;
	}): ScrapedEvent | undefined {
		const { card, wpBySlug, megatixBySlug } = args;
		const wp = card.slug ? wpBySlug.get(card.slug) : undefined;
		const rawMegatixUrl = card.megatixUrl || wp?.megatixUrls[0];
		const megatixSlug = rawMegatixUrl ? megatixSlugFromUrl(rawMegatixUrl) : undefined;
		const megatix = megatixSlug ? megatixBySlug.get(megatixSlug.toLowerCase()) : undefined;
		const megatixEventUrl = megatixSlug ? megatixEventsUrl(megatixSlug) : undefined;

		const imageUrl =
			(megatix?.cover?.startsWith(`http`) ? megatix.cover : undefined) ||
			card.imageUrl ||
			wp?.imageUrl;
		if (!imageUrl) {
			console.error(`Skipping ${card.title}: no poster image`);
			return undefined;
		}

		const fromMegatixStart = megatix?.start_datetime
			? megatixDateTimeToIso(megatix.start_datetime)
			: undefined;
		const fromHint = card.scheduleHint
			? parseCalendarScheduleHint(card.scheduleHint)
			: undefined;
		const startAt = fromMegatixStart || fromHint?.startAt;
		if (!startAt) {
			console.error(`Skipping ${card.title}: no start time (${card.scheduleHint || `no hint`})`);
			return undefined;
		}

		const endAt =
			(megatix?.end_datetime ? megatixDateTimeToIso(megatix.end_datetime) : undefined) ||
			fromHint?.endAt ||
			null;

		const name = (megatix?.name || wp?.title || card.title).replace(/\s+/g, ` `).trim();
		const fromMegatix = megatix?.description
			? extractImagesAndCleanDescription(megatix.description)
			: undefined;
		const description = fromMegatix?.description || wp?.description || null;
		const descriptionImages = fromMegatix?.imageUrls?.length
			? fromMegatix.imageUrls
			: (wp?.descriptionImageUrls ?? []);
		const imageUrls = uniqueUrls([imageUrl, ...descriptionImages]);
		const price =
			priceFromMegatixTickets(megatix?.tickets) ||
			extractPriceFromText(wp?.rawText || card.bodyText || ``) ||
			null;
		const sourceUrl =
			megatixEventUrl ||
			card.detailUrl ||
			wp?.link ||
			(card.slug ? `${SITE_BASE}/event/${card.slug}/` : CALENDAR_PAGE);

		return {
			name,
			startAt,
			endAt,
			timezone: TIMEZONE,
			address: [...VENUE_ADDRESS],
			price,
			priceIsHtml: false,
			description,
			imageUrls,
			host: `The Yoga Barn`,
			hostLink: SITE_BASE,
			contact: [...CONTACT],
			latitude: LATITUDE,
			longitude: LONGITUDE,
			tags: [],
			sourceUrl,
			source: `yogabarn`,
		};
	}

	private async fetchCalendarCardsAhead(monthsAhead: number): Promise<CalendarCard[]> {
		const byKey = new Map<string, CalendarCard>();
		const months = monthAnchorsAhead(monthsAhead);

		for (const date of months) {
			try {
				const html = await this.fetchMonthHtml(date);
				const cards = this.parseCalendarCardsHtml(html);
				console.error(`  ${date}: ${cards.length} cards`);
				for (const card of cards) {
					const key = card.slug || `${normalizeKey(card.title)}|${card.scheduleHint}`;
					const existing = byKey.get(key);
					if (!existing || (!existing.imageUrl && card.imageUrl)) byKey.set(key, card);
				}
			} catch (error) {
				console.error(`Failed to fetch calendar month ${date}:`, error);
			}
			await sleep(120);
		}

		return [...byKey.values()];
	}

	private async fetchMonthHtml(eventDate: string): Promise<string> {
		const url =
			`${CALENDAR_AJAX}?action=event_onmonth&eventDate=${encodeURIComponent(eventDate)}`;
		const res = await fetch(url, {
			headers: {
				[`User-Agent`]: `Mozilla/5.0`,
				Accept: `text/html,*/*`,
				Referer: CALENDAR_PAGE,
			},
		});
		if (!res.ok) throw new Error(`event_onmonth failed: ${res.status}`);
		return await res.text();
	}

	private parseCalendarCardsHtml(html: string): CalendarCard[] {
		const $ = cheerio.load(html);
		const cards: CalendarCard[] = [];

		$(`button.filterable`).each((_, el) => {
			try {
				const btn = $(el);
				const title = decodeHtml(
					btn.find(`.font-heading.text-xs, .font-heading`).first().text().trim(),
				);
				const scheduleHint = btn.find(`.pt-4.pl-8, .text-primary.font-heading`).first().text().trim();
				const detail =
					btn.find(`a[href*="/event/"]`).first().attr(`href`) ||
					btn.find(`a[href*="${SITE_BASE}/event/"]`).first().attr(`href`);
				const slug = detail ? eventSlugFromUrl(detail) : undefined;
				const img = btn.find(`img[src*="/uploads/"]`).first().attr(`src`)?.trim();
				const megatixUrl = btn.find(`a[href*="megatix.co.id"]`).first().attr(`href`)?.trim();
				const bodyText = btn.find(`.accordion-body`).text().replace(/\s+/g, ` `).trim();

				if (!title && !slug) return;

				cards.push({
					title: title || slug || `Yoga Barn event`,
					slug,
					imageUrl: img && isPosterCandidate(img) ? absoluteUrl(img) : undefined,
					megatixUrl: megatixUrl ? megatixUrl.replace(/&amp;/g, `&`) : undefined,
					detailUrl: detail ? absoluteUrl(detail) : undefined,
					scheduleHint,
					bodyText,
				});
			} catch (error) {
				console.error(`Failed to parse calendar card:`, error);
			}
		});

		return cards;
	}

	private async fetchWpEventsBySlug(): Promise<Map<string, WpEventPoster>> {
		const bySlug = new Map<string, WpEventPoster>();
		let page = 1;

		while (true) {
			const url = `${WP_EVENTS_API}?per_page=100&page=${page}&_embed=1`;
			let res: Response;
			try {
				res = await fetch(url, {
					headers: { [`User-Agent`]: `Mozilla/5.0` },
				});
			} catch (error) {
				console.error(`Failed to fetch WP events page ${page}:`, error);
				break;
			}
			if (!res.ok) {
				console.error(`WP events page ${page} failed: ${res.status}`);
				break;
			}

			const batch = (await res.json()) as WpEventJson[];
			if (!batch?.length) break;

			for (const item of batch) {
				try {
					const parsed = this.parseWpEvent(item);
					bySlug.set(parsed.slug, parsed);
				} catch (error) {
					console.error(`Failed to parse WP event ${item.id}:`, error);
				}
			}

			const totalPages = Number(res.headers.get(`x-wp-totalpages`) || 1);
			if (page >= totalPages) break;
			page++;
			await sleep(100);
		}

		return bySlug;
	}

	private parseWpEvent(item: WpEventJson): WpEventPoster {
		const title = decodeHtml(item.title?.rendered || ``);
		const content = item.content?.rendered || ``;
		const $ = cheerio.load(content);
		const megatixUrls = [
			...new Set(
				$(`a[href*="megatix.co.id"]`)
					.map((_, el) => $(el).attr(`href`)?.trim())
					.get()
					.filter((href): href is string => !!href?.includes(`megatix.co.id`)),
			),
		];
		for (const match of content.matchAll(/https:\/\/megatix\.co\.id\/[^\s"'<>]+/g)) {
			megatixUrls.push(match[0].replace(/&amp;/g, `&`));
		}

		const { description, imageUrls: descriptionImageUrls } =
			extractImagesAndCleanDescription(content);
		const featured = item._embedded?.[`wp:featuredmedia`]?.[0]?.source_url;
		const portrait = [...descriptionImageUrls, featured]
			.map((src) => (src ? absoluteUrl(src) : undefined))
			.find((src) => src && /portrait|potrait/i.test(src));
		const imageUrl =
			portrait ||
			[...descriptionImageUrls, featured]
				.map((src) => (src ? absoluteUrl(src) : undefined))
				.find((src) => src && isPosterCandidate(src));

		return {
			title,
			slug: item.slug,
			link: item.link,
			megatixUrls: [...new Set(megatixUrls)],
			imageUrl,
			description,
			descriptionImageUrls,
			rawText: $.root().text().replace(/\s+/g, ` `).trim(),
		};
	}

	private async fetchMegatixEventsByUrls(urls: string[]): Promise<Map<string, MegatixEvent>> {
		const bySlug = new Map<string, MegatixEvent>();
		const slugs = [
			...new Set(urls.map((url) => megatixSlugFromUrl(url)).filter((s): s is string => !!s)),
		];

		for (const slug of slugs) {
			try {
				const event = await this.fetchMegatixEventBySlug(slug);
				if (!event) {
					console.error(`Megatix event not found for ${slug}`);
					continue;
				}
				bySlug.set(slug.toLowerCase(), event);
				bySlug.set(event.slug.toLowerCase(), event);
			} catch (error) {
				console.error(`Failed to fetch Megatix event ${slug}:`, error);
			}
			await sleep(80);
		}

		return bySlug;
	}

	private async fetchMegatixEventBySlug(slug: string): Promise<MegatixEvent | undefined> {
		const direct = await fetchJson<{ data?: MegatixEvent }>(
			`${MEGATIX_BASE}/api/v2/events/${encodeURIComponent(slug)}`,
		);
		if (direct?.data?.slug) return direct.data;

		const base = stripSeasonalSlugSuffix(slug);
		if (base === slug) return undefined;

		const fallback = await fetchJson<{ data?: MegatixEvent }>(
			`${MEGATIX_BASE}/api/v2/events/${encodeURIComponent(base)}`,
		);
		return fallback?.data?.slug ? fallback.data : undefined;
	}
}

function monthAnchorsAhead(monthsAhead: number): string[] {
	const dates: string[] = [];
	const now = new Date();
	const bali = new Date(now.toLocaleString(`en-US`, { timeZone: TIMEZONE }));
	for (let i = 0; i < monthsAhead; i++) {
		const d = new Date(bali.getFullYear(), bali.getMonth() + i, 1);
		// id-ID style used by the calendar JS: D/M/YYYY
		dates.push(`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`);
	}
	return dates;
}

function normalizeKey(value: string): string {
	return decodeHtml(value)
		.toLowerCase()
		.replace(/['’]/g, ``)
		.replace(/&amp;/g, `and`)
		.replace(/[^a-z0-9]+/g, ` `)
		.trim()
		.replace(/\s+/g, ` `);
}

function decodeHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, ``)
		.replace(/&amp;/g, `&`)
		.replace(/&#8217;|&rsquo;|&#39;/g, `'`)
		.replace(/&#8211;/g, `–`)
		.replace(/&nbsp;/g, ` `)
		.replace(/&quot;/g, `"`)
		.trim();
}

function absoluteUrl(url: string): string {
	if (url.startsWith(`http`)) return url;
	if (url.startsWith(`//`)) return `https:${url}`;
	if (url.startsWith(`/`)) return `${SITE_BASE}${url}`;
	return url;
}

function isPosterCandidate(url: string): boolean {
	const absolute = absoluteUrl(url);
	if (!absolute.startsWith(`http`)) return false;
	const lower = absolute.toLowerCase();
	if (FOOTER_IMAGE_MARKERS.some((marker) => lower.includes(marker))) return false;
	if (lower.endsWith(`.svg`)) return false;
	return true;
}

/** Pulls img srcs into imageUrls and returns prose HTML without img tags. */
function extractImagesAndCleanDescription(html: string): {
	description: string | null;
	imageUrls: string[];
} {
	const $ = cheerio.load(html);
	const imageUrls: string[] = [];

	$(`img`).each((_, el) => {
		try {
			const src = $(el).attr(`src`)?.trim();
			$(el).remove();
			if (!src || !isPosterCandidate(src)) return;
			const absolute = absoluteUrl(src);
			if (imageUrls.includes(absolute)) return;
			imageUrls.push(absolute);
		} catch (error) {
			console.error(`Failed to extract description image:`, error);
		}
	});

	const withoutImgs = $(`body`).html() ?? ``;
	return {
		description: cleanProseHtml(withoutImgs) || null,
		imageUrls,
	};
}

function uniqueUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const url of urls) {
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

async function filterImagesByMinBytes(args: {
	urls: string[];
	minBytes: number;
	sizeCache?: Map<string, number | undefined>;
}): Promise<string[]> {
	const cache = args.sizeCache ?? new Map<string, number | undefined>();
	const kept: string[] = [];
	for (const url of args.urls) {
		try {
			let size: number | undefined;
			if (cache.has(url)) {
				size = cache.get(url);
			} else {
				size = await getImageByteSize(url);
				cache.set(url, size);
				await sleep(40);
			}
			if (size === undefined) continue;
			if (size < args.minBytes) {
				console.error(`  skipping image < ${args.minBytes / 1024}kb (${size}b): ${url}`);
				continue;
			}
			kept.push(url);
		} catch (error) {
			console.error(`Failed to check image size for ${url}:`, error);
		}
	}
	return kept;
}

async function getImageByteSize(url: string): Promise<number | undefined> {
	const fromHead = await fetchImageSizeViaHead(url);
	if (fromHead !== undefined) return fromHead;
	return await fetchImageSizeViaGet(url);
}

async function fetchImageSizeViaHead(url: string): Promise<number | undefined> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 8000);
	try {
		const head = await fetch(url, {
			method: `HEAD`,
			signal: ctrl.signal,
			headers: { [`User-Agent`]: `Mozilla/5.0` },
		});
		if (!head.ok) return undefined;
		const size = Number(head.headers.get(`content-length`));
		if (!Number.isFinite(size) || size <= 0) return undefined;
		return size;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchImageSizeViaGet(url: string): Promise<number | undefined> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 12000);
	try {
		const res = await fetch(url, {
			method: `GET`,
			signal: ctrl.signal,
			headers: { [`User-Agent`]: `Mozilla/5.0` },
		});
		if (!res.ok) return undefined;
		const fromHeader = Number(res.headers.get(`content-length`));
		if (Number.isFinite(fromHeader) && fromHeader > 0) {
			await res.body?.cancel();
			return fromHeader;
		}
		const bytes = await res.arrayBuffer();
		return bytes.byteLength;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function eventSlugFromUrl(url: string): string | undefined {
	const match = url.match(/\/event\/([^/?#]+)/i);
	return match?.[1] ? decodeURIComponent(match[1]).replace(/\/$/, ``) : undefined;
}

function megatixSlugFromUrl(url: string): string | undefined {
	const match = url.match(/megatix\.co\.id\/(?:white-label|events)\/([^/?#]+)/i);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function megatixEventsUrl(slug: string): string {
	return `${MEGATIX_BASE}/events/${slug}`;
}

function stripSeasonalSlugSuffix(slug: string): string {
	return slug.replace(
		/-(january|february|march|april|may|june|july|august|september|october|november|december|\d{4})$/i,
		``,
	);
}

function priceFromMegatixTickets(tickets: MegatixTicket[] | undefined): string | undefined {
	if (!tickets?.length) return undefined;

	const open = tickets.filter((t) => !t.is_invisible && !t.is_sales_closed && !t.is_sold_out);
	const pool = open.length ? open : tickets.filter((t) => !t.is_invisible);
	const amounts = pool
		.map((t) => (typeof t.price_display === `number` ? t.price_display / 100 : undefined))
		.filter((n): n is number => typeof n === `number` && n > 0);

	if (!amounts.length) {
		const free = pool.some((t) => t.is_free);
		return free ? `Free` : undefined;
	}
	return formatIdr(Math.min(...amounts));
}

function formatIdr(amount: number): string {
	if (amount >= 1000 && amount % 1000 === 0) {
		return `IDR ${amount / 1000}K`;
	}
	return `IDR ${Math.round(amount).toLocaleString(`en-US`)}`;
}

function megatixDateTimeToIso(raw: string): string | undefined {
	const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
	if (!match) return undefined;
	const [, year, month, day, hour, minute] = match;
	return dateToIsoStr(
		Number(year),
		Number(month),
		Number(day),
		Number(hour),
		Number(minute),
		TIMEZONE,
		false,
	);
}

const MONTHS: Record<string, number> = {
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12,
};

/**
 * Parses calendar schedule lines, e.g.:
 * - `Monday, July 27th | 9:00am - 5:00pm`
 * - `Thursday - Saturday, July 23rd - 25th | 9:30am - 1:30pm`
 * - `July 19th - 21st, 2026` / `August 31st - September 13th, 2026`
 * - `August 11th - 17th, 2026 | 07:00 - 21:00`
 * - `Sundays | 1:30pm - 2:30pm`
 */
function parseCalendarScheduleHint(hint: string): { startAt: string; endAt?: string } | undefined {
	const meridiemRange = hint.match(
		/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
	);
	const h24Range = !meridiemRange
		? hint.match(/\b(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/)
		: undefined;

	let startHour = 9;
	let startMinute = 0;
	let endHour = 17;
	let endMinute = 0;
	let hasTime = false;

	if (meridiemRange) {
		hasTime = true;
		startHour = to24h(Number(meridiemRange[1]), meridiemRange[3]);
		startMinute = Number(meridiemRange[2] || 0);
		endHour = to24h(Number(meridiemRange[4]), meridiemRange[6]);
		endMinute = Number(meridiemRange[5] || 0);
	} else if (h24Range) {
		hasTime = true;
		startHour = Number(h24Range[1]);
		startMinute = Number(h24Range[2]);
		endHour = Number(h24Range[3]);
		endMinute = Number(h24Range[4]);
	}

	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth() + 1;
	let day = now.getDate();
	let endYear = year;
	let endMonth = month;
	let endDay = day;

	const crossMonth = hint.match(
		/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
	);
	const sameMonthRange = hint.match(
		/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
	);
	const dated = hint.match(
		/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
	);

	if (crossMonth) {
		month = monthFromToken(crossMonth[1]) || month;
		day = Number(crossMonth[2]);
		endMonth = monthFromToken(crossMonth[3]) || month;
		endDay = Number(crossMonth[4]);
		if (crossMonth[5]) {
			year = Number(crossMonth[5]);
			endYear = year;
			if (endMonth < month) endYear = year + 1;
		} else {
			({ year, endYear } = inferYearPair({ year, month, day, endMonth, endDay, now }));
		}
	} else if (sameMonthRange) {
		month = monthFromToken(sameMonthRange[1]) || month;
		day = Number(sameMonthRange[2]);
		endMonth = month;
		endDay = Number(sameMonthRange[3]);
		if (sameMonthRange[4]) {
			year = Number(sameMonthRange[4]);
			endYear = year;
		} else {
			({ year, endYear } = inferYearPair({ year, month, day, endMonth, endDay, now }));
		}
	} else if (dated) {
		month = monthFromToken(dated[1]) || month;
		day = Number(dated[2]);
		endMonth = month;
		endDay = day;
		if (dated[3]) {
			year = Number(dated[3]);
			endYear = year;
		} else {
			({ year, endYear } = inferYearPair({ year, month, day, endMonth, endDay, now }));
		}
	} else {
		const weekday = hint.match(
			/\b(Sundays?|Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?)\b/i,
		)?.[1];
		if (!weekday || !hasTime) return undefined;
		const targetDow = weekdayIndex(weekday);
		if (targetDow < 0) return undefined;
		const baliNow = new Date(now.toLocaleString(`en-US`, { timeZone: TIMEZONE }));
		const delta = (targetDow - baliNow.getDay() + 7) % 7;
		baliNow.setDate(baliNow.getDate() + delta);
		year = baliNow.getFullYear();
		month = baliNow.getMonth() + 1;
		day = baliNow.getDate();
		endYear = year;
		endMonth = month;
		endDay = day;
	}

	const startAt = dateToIsoStr(year, month, day, startHour, startMinute, TIMEZONE, false);
	const endAt = dateToIsoStr(endYear, endMonth, endDay, endHour, endMinute, TIMEZONE, false);
	return { startAt, endAt };
}

function weekdayIndex(token: string): number {
	const key = token.toLowerCase().replace(/s$/, ``);
	const map: Record<string, number> = {
		sunday: 0,
		monday: 1,
		tuesday: 2,
		wednesday: 3,
		thursday: 4,
		friday: 5,
		saturday: 6,
	};
	return map[key] ?? -1;
}

function monthFromToken(token: string): number | undefined {
	const key = token.toLowerCase().replace(/\.$/, ``);
	if (MONTHS[key]) return MONTHS[key];
	const aliases: Record<string, number> = {
		jan: 1,
		feb: 2,
		mar: 3,
		apr: 4,
		jun: 6,
		jul: 7,
		aug: 8,
		sep: 9,
		sept: 9,
		oct: 10,
		nov: 11,
		dec: 12,
	};
	return aliases[key];
}

function inferYearPair(args: {
	year: number;
	month: number;
	day: number;
	endMonth: number;
	endDay: number;
	now: Date;
}): { year: number; endYear: number } {
	const { month, day, endMonth, endDay, now } = args;
	let year = args.year;
	const candidate = new Date(year, month - 1, day, 23, 59);
	if (candidate.getTime() < now.getTime() - 12 * 60 * 60 * 1000) year += 1;
	let endYear = year;
	if (endMonth < month || (endMonth === month && endDay < day)) endYear = year + 1;
	return { year, endYear };
}

function to24h(hour: number, meridiem: string): number {
	const m = meridiem.toLowerCase();
	if (m === `am`) return hour === 12 ? 0 : hour;
	return hour === 12 ? 12 : hour + 12;
}

function extractPriceFromText(text: string): string | undefined {
	const matches = [...text.matchAll(/\bIDR\s*([\d.,]+)\s*(k)?\b/gi)];
	if (!matches.length) return undefined;

	const amounts = matches
		.map((m) => {
			const n = Number(m[1].replace(/,/g, ``));
			if (!Number.isFinite(n)) return undefined;
			return m[2] ? n * 1000 : n;
		})
		.filter((n): n is number => typeof n === `number` && n > 0);

	if (!amounts.length) return undefined;
	return formatIdr(Math.min(...amounts));
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 12000);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: {
				Accept: `application/json`,
				[`User-Agent`]: `Mozilla/5.0`,
			},
		});
		if (!res.ok) return undefined;
		return (await res.json()) as T;
	} finally {
		clearTimeout(timer);
	}
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		console.log(JSON.stringify(await scraper.scrapeWebsite(), null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type CalendarCard = {
	title: string;
	slug?: string;
	imageUrl?: string;
	megatixUrl?: string;
	detailUrl?: string;
	scheduleHint?: string;
	bodyText?: string;
};

type MegatixTicket = {
	name?: string;
	price_display?: number;
	is_free?: boolean;
	is_invisible?: boolean;
	is_sales_closed?: boolean;
	is_sold_out?: boolean;
};

type MegatixEvent = {
	id: number;
	name: string;
	slug: string;
	description?: string;
	cover?: string;
	start_datetime?: string | null;
	end_datetime?: string | null;
	tickets?: MegatixTicket[];
};

type WpEventPoster = {
	title: string;
	slug: string;
	link: string;
	megatixUrls: string[];
	imageUrl?: string;
	description?: string | null;
	descriptionImageUrls: string[];
	rawText?: string;
};

type WpEventJson = {
	id: number;
	slug: string;
	link: string;
	title?: { rendered?: string };
	content?: { rendered?: string };
	featured_media?: number;
	_embedded?: {
		[`wp:featuredmedia`]?: Array<{ source_url?: string }>;
	};
};
