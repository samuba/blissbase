/**
 * Scrapes conscious-events.com from sitemap.xml (`/de/event/{slug}`), then
 * each occurrence page. Structured data comes from schema.org Event JSON-LD.
 *
 * Usage:
 *   bun run scripts/scrape-consciousevents.ts
 *   bun run scripts/scrape-consciousevents.ts <html_file> ...
 */
import * as cheerio from 'cheerio';
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	sleep,
	superTrim,
	type TimeZoneString,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://conscious-events.com`;
const SITEMAP_URL = `${SITE_BASE}/sitemap.xml`;
const DEFAULT_TIMEZONE = `Europe/Berlin` as const;
const SOURCE = `consciousevents` as const;
const DETAIL_CONCURRENCY = 6;
const SKIP_SLUGS = new Set([`anmeldung-testevent`]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		console.error(`Fetching conscious-events sitemap...`);
		const baseUrls = await this.fetchEventUrlsFromSitemap();
		console.error(`Found ${baseUrls.length} event pages in sitemap`);

		const occurrenceUrls = await this.collectOccurrenceUrls(baseUrls);
		console.error(`Fetching ${occurrenceUrls.length} upcoming occurrence pages...`);

		const results = await mapWithConcurrency({
			items: occurrenceUrls,
			concurrency: DETAIL_CONCURRENCY,
			mapper: async (url) => {
				try {
					const html = await customFetch(url, { returnType: `text` });
					return await this.extractEventData(html, url);
				} catch (error) {
					console.error(`Failed to process ${url}:`, error);
					return undefined;
				}
			},
		});

		for (const event of results) {
			if (!event) continue;
			if (!isFutureIso(event.startAt)) continue;
			allEvents.push(event);
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
				if (!isFutureIso(event.startAt)) continue;
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

			if (!isFutureIso(startAt)) {
				console.error(`Skipping past event ${url}`);
				return undefined;
			}

			const address = this.extractAddress(html) ?? [];
			const ld = this.extractLdEvent(html);
			let latitude = this.extractLatitude(html);
			let longitude = this.extractLongitude(html);
			let timezone: string | null = DEFAULT_TIMEZONE;

			if ((latitude == null || longitude == null) && address?.length && !isOnlineLocation(address)) {
				try {
					const geocoded = await geocodeAddressCached({
						addressLines: address,
						apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
					});
					latitude = latitude ?? geocoded?.lat ?? null;
					longitude = longitude ?? geocoded?.lng ?? null;
					timezone = geocoded?.timezone ?? timezone;
				} catch (error) {
					console.error(`Geocoding failed for ${url}:`, error);
				}
			}

			const sourceUrl = canonicalizeSourceUrl({
				url,
				ldUrl: typeof ld?.url === `string` ? ld.url : undefined,
			});

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
				contact: this.extractContact(html),
				latitude,
				longitude,
				timezone,
				tags: this.extractTags(html) ?? [],
				sourceUrl,
				source: SOURCE,
			} satisfies ScrapedEvent;
		} catch (error) {
			console.error(`Error extracting event data from ${url}:`, error);
			return undefined;
		}
	}

	extractName(html: string): string | undefined {
		// Occurrence pages append the date to JSON-LD name; h1 stays clean.
		const $ = cheerio.load(html);
		const h1 = superTrim($(`h1`).first().text());
		if (h1) return h1;

		const ld = this.extractLdEvent(html);
		const ldName = superTrim(typeof ld?.name === `string` ? ld.name : undefined);
		if (!ldName) return undefined;
		return ldName.replace(/\s+[—–-]\s+\S.*,\s+\d{1,2}\.\s+\S+\s+\d{4}\s*$/, ``).trim() || ldName;
	}

	extractStartAt(html: string): string | undefined {
		const ld = this.extractLdEvent(html);
		return utcIsoToZonedIso(ld?.startDate, DEFAULT_TIMEZONE);
	}

	extractEndAt(html: string): string | undefined {
		const ld = this.extractLdEvent(html);
		const endAt = utcIsoToZonedIso(ld?.endDate, DEFAULT_TIMEZONE);
		const startAt = utcIsoToZonedIso(ld?.startDate, DEFAULT_TIMEZONE);
		if (!endAt || !startAt) return endAt;
		if (endAt === startAt) return undefined;
		return endAt;
	}

	extractAddress(html: string): string[] | undefined {
		if (this.isOnlineEvent(html)) return [`Online`];

		const lines: string[] = [];
		const seen = new Set<string>();
		const push = (raw: string | undefined) => {
			const text = superTrim(raw);
			if (!text) return;
			for (const part of text.split(`,`)) {
				const line = superTrim(part);
				if (!line) continue;
				const key = line.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				lines.push(line);
			}
		};

		const location = this.extractLdEvent(html)?.location;
		if (location && typeof location === `object` && location[`@type`] !== `VirtualLocation`) {
			push(typeof location.name === `string` ? location.name : undefined);
			const address = location.address;
			if (typeof address === `string`) {
				push(address);
			} else if (address && typeof address === `object`) {
				push(address.streetAddress);
				push([address.postalCode, address.addressLocality].filter(Boolean).join(` `));
				push(address.addressCountry);
			}
		}

		push(extractSidebarValue({ html, label: `Ort` }));
		return lines;
	}

	extractPrice(html: string): string | undefined {
		const fromOffers = formatOffers(this.extractLdEvent(html)?.offers);
		if (fromOffers) return fromOffers;

		const sidebar = extractSidebarValue({ html, label: `Preis` });
		if (!sidebar) return undefined;
		if (/anfrage/i.test(sidebar)) return `Preis auf Anfrage`;
		return superTrim(sidebar.replace(/\s+/g, ` `));
	}

	extractDescription(html: string): string | undefined {
		const $ = cheerio.load(html);
		const prose = $(`.prose`).first();
		if (prose.length) {
			const cleaned = cleanProseHtml(prose.html() || ``);
			if (cleaned?.trim()) return cleaned;
		}

		const ld = this.extractLdEvent(html);
		const description = superTrim(typeof ld?.description === `string` ? ld.description : undefined);
		if (!description) return undefined;
		return cleanProseHtml(`<p>${escapeHtml(description)}</p>`);
	}

	extractImageUrls(html: string): string[] | undefined {
		const urls: string[] = [];
		const seen = new Set<string>();
		const add = (raw: unknown) => {
			if (typeof raw !== `string` || !raw.trim()) return;
			if (/opengraph-image|\/avatars\/|\/providers\//i.test(raw)) return;
			const normalized = normalizeCdnImageUrl(raw.trim());
			if (!normalized) return;
			const key = normalized.split(`?`)[0];
			if (seen.has(key)) return;
			seen.add(key);
			urls.push(normalized);
		};

		const ld = this.extractLdEvent(html);
		const image = ld?.image;
		if (Array.isArray(image)) {
			for (const item of image) add(item);
		} else {
			add(image);
		}

		const $ = cheerio.load(html);
		for (const el of [
			...$(`section`).first().find(`img`).toArray(),
			...$(`.prose img`).toArray(),
		]) {
			const $el = $(el);
			if ($el.closest(`a[href*="/event/"]`).length) continue; // other events by the same host
			add($el.attr(`src`) || $el.attr(`data-src`));
		}

		return urls;
	}

	extractHost(html: string): string | undefined {
		const ld = this.extractLdEvent(html);
		const organizer = ld?.organizer;
		if (organizer && typeof organizer === `object` && typeof organizer.name === `string`) {
			const name = superTrim(organizer.name);
			if (name) return name;
		}

		const $ = cheerio.load(html);
		const heading = $(`h2`).filter((_i, el) => $(el).text().includes(`Anbietende`)).first();
		if (!heading.length) return undefined;
		return superTrim(heading.parent().parent().find(`h3`).first().text());
	}

	extractHostLink(html: string): string | undefined {
		const ld = this.extractLdEvent(html);
		const organizer = ld?.organizer;
		if (organizer && typeof organizer === `object` && typeof organizer.url === `string`) {
			if (!organizer.url.includes(`/event/`)) return organizer.url;
		}

		const $ = cheerio.load(html);
		const href = $(`a[href*="/host/"]`).first().attr(`href`);
		if (!href) return undefined;
		try {
			return new URL(href, SITE_BASE).toString();
		} catch {
			return undefined;
		}
	}

	extractTags(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const tags = new Set<string>();
		const add = (raw: string | undefined) => {
			const tag = superTrim(raw);
			if (!tag) return;
			if (tag.length > 40) return;
			if (/^(event|zoom|·)$/i.test(tag)) return;
			tags.add(tag);
		};

		const row = $(`section`).first().find(`span.text-terracotta`).first().parent();
		row.children().each((_i, el) => {
			if ($(el).attr(`aria-hidden`)) return;
			add($(el).text());
		});

		if (this.isOnlineEvent(html)) add(`Online`);

		return [...tags];
	}

	extractContact(html: string): string[] {
		const platform: string[] = [];
		const hinted: string[] = [];
		const messengerSignup: string[] = [];
		const other: string[] = [];
		const emails: string[] = [];
		const seen = new Set<string>();
		const push = (value: string | undefined, bucket: string[]) => {
			const cleaned = superTrim(value);
			if (!cleaned) return;
			if (/deine@email\.de|example\.com|sentry\.io/i.test(cleaned)) return;
			const key = cleaned.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			bucket.push(cleaned);
		};

		const considerHref = (href: string | undefined, hint: string) => {
			if (!href) return;
			if (href.startsWith(`mailto:`)) {
				push(href.slice(`mailto:`.length).split(`?`)[0], emails);
				return;
			}
			const url = normalizeExternalContactUrl(href);
			if (!url) return;
			const kind = bookingKind({ url, hint });
			if (kind === `platform`) push(url, platform);
			else if (kind === `hint`) push(url, hinted);
			else if (kind === `messengerSignup`) push(url, messengerSignup);
			else push(url, other);
		};

		const offers = this.extractLdEvent(html)?.offers;
		const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
		for (const offer of offerList) {
			if (!offer || typeof offer !== `object`) continue;
			if (typeof offer.url !== `string`) continue;
			considerHref(offer.url, `ticket`);
		}

		const $ = cheerio.load(html);
		const prose = $(`.prose`).first();
		const proseText = (prose.html() || ``).replace(/<[^>]+>/g, ` `);
		prose.find(`a[href]`).each((_i, el) => {
			const href = $(el).attr(`href`);
			const text = superTrim($(el).text()) ?? ``;
			const parentText = superTrim($(el).closest(`p`).text() || $(el).parent().text()) ?? ``;
			const around = surroundingText({
				text: parentText || proseText,
				match: text || href || ``,
			});
			considerHref(href, `${text} ${around}`);
		});

		for (const match of proseText.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
			const url = match.replace(/[).,;:]+$/g, ``);
			considerHref(url, surroundingText({ text: proseText, match: url }));
		}
		for (const match of proseText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,6}(?![A-Z0-9])/gi) ?? []) {
			push(match, emails);
		}

		if (platform?.length || hinted?.length || messengerSignup?.length) {
			if (platform?.length) return [...platform, ...messengerSignup];
			if (hinted?.length) return [...hinted, ...messengerSignup];
			return messengerSignup;
		}
		return [...other, ...emails];
	}

	isOnlineEvent(html: string): boolean {
		const ld = this.extractLdEvent(html);
		if (typeof ld?.eventAttendanceMode === `string` && /Online/i.test(ld.eventAttendanceMode)) {
			return true;
		}
		if (ld?.location?.[`@type`] === `VirtualLocation`) return true;
		const ort = extractSidebarValue({ html, label: `Ort` });
		return Boolean(ort && /^online$/i.test(ort));
	}

	extractLatitude(html: string): number | null {
		const geo = this.extractLdEvent(html)?.location?.geo;
		const value = geo && typeof geo === `object` ? toNumber(geo.latitude) : null;
		return value;
	}

	extractLongitude(html: string): number | null {
		const geo = this.extractLdEvent(html)?.location?.geo;
		const value = geo && typeof geo === `object` ? toNumber(geo.longitude) : null;
		return value;
	}

	extractOccurrenceUrls(html: string): string[] {
		const $ = cheerio.load(html);
		const urls = new Set<string>();
		const now = new Date();
		const todayKey = yymmdd(now);

		$(`a[href*="/event/"]`).each((_i, el) => {
			const href = $(el).attr(`href`);
			if (!href) return;
			const match = href.match(/\/event\/([^/?#]+)\/(\d{6})\/?$/);
			if (!match) return;
			const [, slug, dateKey] = match;
			if (SKIP_SLUGS.has(slug)) return;
			if (dateKey < todayKey) return;

			// Same-day links can already be in the past — use the listed start time.
			if (dateKey === todayKey) {
				const startTime = extractStartTimeFromText($(el).text());
				if (!startTime || !isFutureYymmddTime({ dateKey, startTime, now })) return;
			}

			try {
				urls.add(new URL(href, SITE_BASE).toString().replace(/\/$/, ``));
			} catch {
				/* ignore */
			}
		});

		return [...urls];
	}

	private async fetchEventUrlsFromSitemap(): Promise<string[]> {
		const xml = await customFetch(SITEMAP_URL, { returnType: `text` });
		const urls = [...xml.matchAll(/<loc>(https:\/\/conscious-events\.com\/de\/event\/[^<]+)<\/loc>/g)]
			.map((match) => match[1])
			.filter((url) => !/\/\d{6}$/.test(url))
			.filter((url) => {
				const slug = url.split(`/`).pop() ?? ``;
				return !SKIP_SLUGS.has(slug);
			});

		return [...new Set(urls)];
	}

	private async collectOccurrenceUrls(baseUrls: string[]): Promise<string[]> {
		const occurrenceUrls = new Set<string>();

		const results = await mapWithConcurrency({
			items: baseUrls,
			concurrency: DETAIL_CONCURRENCY,
			mapper: async (baseUrl) => {
				try {
					const html = await customFetch(baseUrl, { returnType: `text` });
					const occ = this.extractOccurrenceUrls(html);
					if (occ?.length) return occ;

					// Single-date events may only expose the canonical URL.
					const startAt = this.extractStartAt(html);
					if (startAt && isFutureIso(startAt)) return [baseUrl];
					return [];
				} catch (error) {
					console.error(`Failed to list occurrences for ${baseUrl}:`, error);
					return [];
				}
			},
		});

		for (const urls of results) {
			for (const url of urls) occurrenceUrls.add(url);
		}

		return [...occurrenceUrls];
	}

	private extractLdEvent(html: string): LdEvent | undefined {
		const $ = cheerio.load(html);
		for (const el of $(`script[type="application/ld+json"]`).toArray()) {
			try {
				const parsed = JSON.parse($(el).html() || ``);
				const items = Array.isArray(parsed)
					? parsed
					: parsed?.[`@graph`] && Array.isArray(parsed[`@graph`])
						? parsed[`@graph`]
						: [parsed];
				for (const item of items) {
					if (item?.[`@type`] === `Event`) return item as LdEvent;
				}
			} catch {
				continue;
			}
		}
		return undefined;
	}
}

function canonicalizeSourceUrl(args: { url: string; ldUrl?: string }): string {
	const candidate = args.ldUrl || args.url;
	try {
		return new URL(candidate, SITE_BASE).toString().replace(/\/$/, ``);
	} catch {
		return args.url;
	}
}

function utcIsoToZonedIso(value: unknown, timeZone: TimeZoneString): string | undefined {
	if (typeof value !== `string` || !value.trim()) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;

	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
		hour: `2-digit`,
		minute: `2-digit`,
		hourCycle: `h23`,
	}).formatToParts(date);

	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value;
	const year = Number(get(`year`));
	const month = Number(get(`month`));
	const day = Number(get(`day`));
	const hour = Number(get(`hour`));
	const minute = Number(get(`minute`));
	if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return undefined;

	return dateToIsoStr(year, month, day, hour, minute, timeZone, false);
}

function normalizeCdnImageUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		// Strip Cloudflare image transform prefix to keep a stable original asset URL.
		parsed.pathname = parsed.pathname.replace(
			/^\/cdn-cgi\/image\/[^/]+\//,
			`/`,
		);
		return parsed.toString();
	} catch {
		return undefined;
	}
}

function extractSidebarValue(args: { html: string; label: string }): string | undefined {
	const $ = cheerio.load(args.html);
	const label = $(`p`).filter((_i, el) => {
		const cls = $(el).attr(`class`) || ``;
		if (!cls.includes(`uppercase`)) return false;
		return $(el).text().trim() === args.label;
	}).first();
	if (!label.length) return undefined;

	const value = label.next(`p`).clone();
	value.find(`span`).remove();
	return superTrim(value.text());
}

function formatOffers(offers: LdEvent[`offers`]): string | undefined {
	const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
	const priced: { name?: string; amount: number; currency: string }[] = [];

	for (const offer of list) {
		if (!offer || typeof offer !== `object`) continue;
		const currency = offer.priceCurrency === `EUR` ? `€` : offer.priceCurrency || `€`;
		const spec = offer.priceSpecification;
		const specMin = spec && typeof spec === `object` ? toNumber(spec.minPrice) : null;
		const specMax = spec && typeof spec === `object` ? toNumber(spec.maxPrice) : null;
		const amount = specMin ?? toNumber(offer.price);
		if (amount == null) continue;
		priced.push({
			name: superTrim(typeof offer.name === `string` ? offer.name : undefined),
			amount,
			currency,
		});
		if (specMax != null && specMax !== amount) {
			priced.push({ currency, amount: specMax });
		}
	}

	const amounts = priced.map((item) => item.amount);
	const maxAmount = amounts.length ? Math.max(...amounts) : 0;
	const kept = priced.filter((item) => {
		if (maxAmount >= 20 && item.amount < maxAmount * 0.05) return false;
		return true;
	});
	if (!kept?.length) return undefined;

	const currency = kept[0].currency;
	const named = kept.filter((item) => item.name);
	if (named.length > 1) {
		return named.map((item) => `${item.name} ${formatEuro({ amount: item.amount, currency })}`).join(` · `);
	}

	const uniqueAmounts = [...new Set(kept.map((item) => item.amount))].sort((a, b) => a - b);
	if (uniqueAmounts.length > 1) {
		return `${formatEuro({ amount: uniqueAmounts[0], currency })} – ${formatEuro({ amount: uniqueAmounts[uniqueAmounts.length - 1], currency })}`;
	}
	return formatEuro({ amount: uniqueAmounts[0], currency });
}

function formatEuro(args: { amount: number; currency: string }) {
	const value = Number.isInteger(args.amount)
		? String(args.amount)
		: args.amount.toFixed(2).replace(`.`, `,`);
	if (args.currency === `€`) return `${value}€`;
	return `${value} ${args.currency}`;
}

function toNumber(value: unknown): number | null {
	if (value == null || value === ``) return null;
	const n = Number(value);
	if (Number.isNaN(n)) return null;
	return n;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function isOnlineLocation(address: string[]) {
	return address.some((line) => /\bonline\b/i.test(line));
}

function yymmdd(date: Date) {
	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone: DEFAULT_TIMEZONE,
		year: `2-digit`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? `00`;
	return `${get(`year`)}${get(`month`)}${get(`day`)}`;
}

function extractStartTimeFromText(text: string): string | undefined {
	const match = text.replace(/\s+/g, ` `).match(/(\d{1,2}:\d{2})\s*[—–-]/);
	return match?.[1];
}

function isFutureIso(iso: string, now = new Date()) {
	const ms = new Date(iso).getTime();
	if (Number.isNaN(ms)) return false;
	return ms > now.getTime();
}

function isFutureYymmddTime(args: {
	dateKey: string;
	startTime: string;
	now?: Date;
}): boolean {
	const { dateKey, startTime, now = new Date() } = args;
	const year = 2000 + Number(dateKey.slice(0, 2));
	const month = Number(dateKey.slice(2, 4));
	const day = Number(dateKey.slice(4, 6));
	const [hour, minute] = startTime.split(`:`).map(Number);
	if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return false;

	const iso = dateToIsoStr(year, month, day, hour, minute, DEFAULT_TIMEZONE, false);
	return isFutureIso(iso, now);
}

async function mapWithConcurrency<T, R>(args: {
	items: T[];
	concurrency: number;
	mapper: (item: T) => Promise<R>;
}): Promise<R[]> {
	const { items, concurrency, mapper } = args;
	if (!items?.length) return [];

	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
			if (nextIndex < items.length) await sleep(50);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

function normalizeExternalContactUrl(href: string): string | undefined {
	const raw = superTrim(href);
	if (!raw) return undefined;
	try {
		const url = new URL(raw, SITE_BASE);
		if (!/^https?:$/.test(url.protocol)) return undefined;
		if (isSkippedContactUrl(url)) return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

function isSkippedContactUrl(url: URL) {
	const host = url.hostname.replace(/^www\./, ``).toLowerCase();
	if (host === `conscious-events.com` || host.endsWith(`.conscious-events.com`)) return true;
	if (host.endsWith(`sentry.io`)) return true;
	if (host === `maps.app.goo.gl` || host.endsWith(`.maps.app.goo.gl`)) return true;
	if (host === `google.com` || host.endsWith(`.google.com`) || host === `google.de` || host.endsWith(`.google.de`)) {
		if (url.pathname.includes(`/forms`)) return false;
		return true;
	}
	return false;
}

const BOOKING_HOSTS = [
	`eventfrog.ch`,
	`eventfrog.de`,
	`eventfrog.com`,
	`eventfrog.at`,
	`pretix.eu`,
	`eventbrite.com`,
	`eventbrite.de`,
	`eventbrite.at`,
	`ticket.io`,
	`weezevent.com`,
	`eveeno.com`,
	`reservix.de`,
	`reservix.at`,
	`eventim.de`,
	`elopage.com`,
	`sei.jetzt`,
	`eversports.com`,
	`bookwhen.com`,
	`simplybook.me`,
	`buy.stripe.com`,
	`forms.gle`,
	`tickettailor.com`,
];
const BOOKING_HINT = /ticket|anmeld|buchen|buchung|vorverkauf|\bkarten\b|registration|sign[\s-]?up/i;
const MESSENGER_HOSTS = [
	`t.me`,
	`telegram.me`,
	`telegram.org`,
	`wa.me`,
	`whatsapp.com`,
	`api.whatsapp.com`,
	`signal.me`,
	`signal.org`,
];

function bookingKind(args: { url: string; hint: string }): `platform` | `hint` | `messengerSignup` | undefined {
	let parsed;
	try {
		parsed = new URL(args.url);
	} catch {
		return undefined;
	}

	const host = parsed.hostname.replace(/^www\./, ``).toLowerCase();
	if (MESSENGER_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
		if (isMessengerSignup(args.hint)) return `messengerSignup`;
		return undefined;
	}
	if (BOOKING_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return `platform`;
	if (/\/(tickets?|anmeldung|booking|register|registration|events?)(\/|$)/i.test(parsed.pathname)) {
		return `platform`;
	}
	if (BOOKING_HINT.test(args.hint)) return `hint`;
	return undefined;
}

function isMessengerSignup(hint: string) {
	const text = hint.replace(/\s+/g, ` `);
	if (!/anmeld|buchen|buchung|registration|sign[\s-]?up/i.test(text)) return false;
	if (!/(telegram|whatsapp|signal|t\.me|wa\.me)/i.test(text)) return false;
	if (
		/(telegram[- ]gruppe|\bcommunity\b|bleib auf dem laufenden|stay updated)/i.test(text) &&
		!/anmeld\w*\s+(?:per|via|über|unter|mit|in der|in die)\s+(?:der\s+|die\s+)?(?:telegram|whatsapp|signal)/i.test(
			text,
		)
	) {
		return false;
	}
	return /anmeld\w{0,12}.{0,40}(telegram|whatsapp|signal|t\.me|wa\.me)|(telegram|whatsapp|signal|t\.me|wa\.me).{0,40}anmeld/i.test(
		text,
	);
}

function surroundingText(args: { text: string; match: string }) {
	const index = args.text.toLowerCase().indexOf(args.match.toLowerCase());
	if (index < 0) return args.match;
	return args.text.slice(Math.max(0, index - 80), index + args.match.length + 80);
}

type LdOffer = {
	name?: string;
	url?: string;
	price?: string | number;
	priceCurrency?: string;
	priceSpecification?: {
		minPrice?: string | number;
		maxPrice?: string | number;
		priceCurrency?: string;
	};
};

type LdEvent = {
	name?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	url?: string;
	image?: string | string[];
	eventAttendanceMode?: string;
	location?: {
		[`@type`]?: string;
		name?: string;
		url?: string;
		address?:
			| string
			| {
					streetAddress?: string;
					postalCode?: string;
					addressLocality?: string;
					addressCountry?: string;
				};
		geo?: {
			latitude?: number | string;
			longitude?: number | string;
		};
	};
	organizer?: {
		name?: string;
		url?: string;
	};
	offers?: LdOffer | LdOffer[];
};

// Allow running this file directly for quick smoke tests.
if (import.meta.main) {
	const scraper = new WebsiteScraper();
	const filePaths = process.argv.slice(2);
	const events = filePaths?.length
		? await scraper.scrapeHtmlFiles(filePaths)
		: await scraper.scrapeWebsite();
	console.log(JSON.stringify(events, null, 2));
}
