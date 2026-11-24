/**
 * Scrapes balibuddies.com via The Events Calendar REST API, then enriches
 * each event from its detail page (JSON-LD times, description, images).
 *
 * Usage:
 *   bun run scripts/scrape-balibuddies.ts
 *   bun run scripts/scrape-balibuddies.ts <html_file> ...
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from "cheerio";
import {
	WebsiteScraperInterface,
	REQUEST_DELAY_MS,
	cleanProseHtml,
	customFetch,
	dateToIsoStr,
	makeAbsoluteUrl,
	sleep,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://balibuddies.com`;
const EVENTS_API = `${SITE_BASE}/wp-json/tribe/events/v1/events`;
const DEFAULT_TIMEZONE = `Asia/Jakarta`;
const SOURCE = `balibuddies` as const;
const PER_PAGE = 50;
const SKIP_IMAGE_MARKERS = [`tribe-loading`, `tribe-spinner`, `gravatar`, `emoji`, `mediavine`];

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		console.error(`Fetching Bali Buddies events from Tribe Events REST API...`);

		let restEvents: TribeEvent[] = [];
		try {
			restEvents = await this.fetchUpcomingEvents();
		} catch (error) {
			console.error(`Failed to fetch event list:`, error);
			return [];
		}

		console.error(`Found ${restEvents.length} upcoming events. Enriching from detail pages...`);

		for (const restEvent of restEvents) {
			try {
				if (!this.isFutureRestEvent(restEvent)) {
					console.error(
						`Skipping past event ${restEvent.id} (${restEvent.title}): ${restEvent.start_date} – ${restEvent.end_date}`,
					);
					continue;
				}
				const event = await this.restEventToScrapedEvent(restEvent);
				if (!event) continue;
				if (!isFutureScrapedEvent(event)) {
					console.error(`Skipping past event after parse: ${event.name} (${event.startAt})`);
					continue;
				}
				allEvents.push(event);
				console.error(`✓ ${event.name} (${event.startAt})`);
			} catch (error) {
				console.error(`Failed to process ${restEvent.url ?? restEvent.id}:`, error);
			}
			await sleep(REQUEST_DELAY_MS);
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
				if (!isFutureScrapedEvent(event)) {
					console.error(`Skipping past event from file ${filePath}: ${event.name} (${event.startAt})`);
					continue;
				}
				allEvents.push(event);
			} catch (error) {
				console.error(`Failed to process file ${filePath}:`, error);
			}
		}
		return allEvents;
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		const name = this.extractName(html);
		if (!name) {
			console.error(`Missing name for ${url}`);
			return undefined;
		}

		const startAt = this.extractStartAt(html);
		if (!startAt) {
			console.error(`Missing start date for ${url} (${name})`);
			return undefined;
		}

		return this.toScrapedEvent({
			name,
			startAt,
			endAt: this.extractEndAt(html),
			address: this.extractAddress(html) ?? [],
			price: this.extractPrice(html),
			description: this.extractDescription(html),
			imageUrls: this.extractImageUrls(html) ?? [],
			host: this.extractHost(html),
			hostLink: this.extractHostLink(html),
			contact: this.extractContact(html),
			tags: this.extractTags(html) ?? [],
			sourceUrl: url.startsWith(`http`) ? url : `${SITE_BASE}/`,
		});
	}

	extractName(html: string): string | undefined {
		const ld = this.getLdEvent(html);
		const fromLd = decodeHtmlEntities(ld?.name);
		if (fromLd) return fromLd;

		const $ = cheerio.load(html);
		const fromTitle = decodeHtmlEntities(
			$(`.tribe-events-single-event-title`).first().text(),
		);
		return fromTitle || undefined;
	}

	extractStartAt(html: string): string | undefined {
		const ld = this.getLdEvent(html);
		if (ld?.startDate?.trim()) return ld.startDate.trim();
		return this.extractDatesFromDom(html).startAt;
	}

	extractEndAt(html: string): string | undefined {
		const ld = this.getLdEvent(html);
		if (ld?.endDate?.trim()) {
			if (ld.endDate.trim() === ld.startDate?.trim()) return undefined;
			return ld.endDate.trim();
		}
		return this.extractDatesFromDom(html).endAt;
	}

	extractAddress(html: string): string[] | undefined {
		const ld = this.getLdEvent(html);
		const location = ld?.location;
		if (!location) {
			const $ = cheerio.load(html);
			const venueName = decodeHtmlEntities(
				$(`.tribe-venue a, .tribe-events-meta-group-venue .tribe-venue`).first().text(),
			);
			return venueName ? [venueName] : [];
		}

		const lines: string[] = [];
		const name = decodeHtmlEntities(location.name);
		if (name) lines.push(name);

		const addr = location.address;
		if (addr) {
			const street = decodeHtmlEntities(addr.streetAddress);
			if (street) lines.push(street);

			const cityLine = [addr.postalCode, addr.addressLocality]
				.map((part) => decodeHtmlEntities(part))
				.filter(Boolean)
				.join(` `);
			if (cityLine) lines.push(cityLine);

			const region = decodeHtmlEntities(addr.addressRegion);
			if (region && !cityLine.includes(region)) lines.push(region);

			const country = decodeHtmlEntities(addr.addressCountry);
			if (country) lines.push(country);
		}

		return lines;
	}

	extractPrice(html: string): string | undefined {
		const $ = cheerio.load(html);
		const fromDom = superTrimText($(`.tribe-events-cost, .tribe-events-event-cost`).first().text());
		if (fromDom) return fromDom;

		const ld = this.getLdEvent(html);
		const offer = ld?.offers;
		if (!offer?.price) return undefined;
		const currency = offer.priceCurrency === `IDR` ? `IDR` : offer.priceCurrency || ``;
		return currency ? `${offer.price} ${currency}` : String(offer.price);
	}

	extractDescription(html: string): string | undefined {
		const $ = cheerio.load(html);
		const $desc = $(`.tribe-events-single-event-description`).first().clone();
		if (!$desc?.length) return undefined;

		$desc.find(`script, style, img, .tribe-events-c-subscribe-dropdown`).remove();
		$desc.find(`*`).each((_, el) => {
			const attribs = $(el).attr() ?? {};
			for (const key of Object.keys(attribs)) {
				if (key === `href` || key === `src` || key === `alt` || key === `target` || key === `rel`) continue;
				$(el).removeAttr(key);
			}
		});
		const raw = $desc.html()?.trim();
		if (!raw) return undefined;
		return cleanProseHtml(raw) || undefined;
	}

	extractImageUrls(html: string): string[] | undefined {
		const $ = cheerio.load(html);
		const urls: string[] = [];
		const seen = new Set<string>();

		const pushUrl = (raw: string | undefined) => {
			const absolute = makeAbsoluteUrl(raw?.trim(), SITE_BASE);
			if (!absolute) return;
			if (!/^https?:\/\//i.test(absolute)) return;
			if (SKIP_IMAGE_MARKERS.some((marker) => absolute.toLowerCase().includes(marker))) return;
			const key = absolute.split(`?`)[0];
			if (seen.has(key)) return;
			seen.add(key);
			urls.push(absolute);
		};

		$(`.tribe-events-single-event-description img`).each((_, el) => {
			pushUrl(
				pickLargestFromSrcset($(el).attr(`srcset`) || $(el).attr(`data-srcset`)) ||
					$(el).attr(`src`) ||
					$(el).attr(`data-src`),
			);
		});

		$(`.tribe-events-event-image img, img.wp-post-image`).each((_, el) => {
			pushUrl(
				pickLargestFromSrcset($(el).attr(`srcset`) || $(el).attr(`data-srcset`)) ||
					$(el).attr(`src`) ||
					$(el).attr(`data-src`),
			);
		});

		const ldImage = this.getLdEvent(html)?.image;
		if (typeof ldImage === `string`) pushUrl(ldImage);
		else if (Array.isArray(ldImage)) {
			for (const img of ldImage) {
				if (typeof img === `string`) pushUrl(img);
			}
		}

		return urls;
	}

	extractHost(html: string): string | undefined {
		const ld = this.getLdEvent(html);
		const fromLd = decodeHtmlEntities(ld?.organizer?.name);
		if (fromLd) return fromLd;

		const $ = cheerio.load(html);
		const fromDom = decodeHtmlEntities(
			$(`.tribe-organizer a, .tribe-events-meta-group-organizer .tribe-organizer`)
				.first()
				.text(),
		);
		return fromDom || undefined;
	}

	extractHostLink(html: string): string | undefined {
		const ld = this.getLdEvent(html);
		const fromLd =
			normalizeUrl(ld?.organizer?.url) || normalizeUrl(ld?.organizer?.sameAs);
		if (fromLd && !isBaliBuddiesUrl(fromLd)) return fromLd;

		const $ = cheerio.load(html);
		const website = normalizeUrl(
			$(`.tribe-organizer-url a, .tribe-events-event-url a`).first().attr(`href`),
		);
		if (website && !isBaliBuddiesUrl(website)) return website;

		return fromLd || website || undefined;
	}

	extractTags(html: string): string[] | undefined {
		const tags = new Set<string>();
		const $ = cheerio.load(html);

		$(`.tribe-events-event-categories a, a[rel="tag"]`).each((_, el) => {
			const tag = decodeHtmlEntities($(el).text());
			if (tag) tags.add(tag);
		});

		return [...tags];
	}

	extractContact(html: string): string[] {
		const contacts: string[] = [];
		const seen = new Set<string>();
		const push = (value: string | undefined) => {
			const cleaned = value?.trim();
			if (!cleaned) return;
			if (seen.has(cleaned)) return;
			seen.add(cleaned);
			contacts.push(cleaned);
		};

		const ld = this.getLdEvent(html);
		push(decodeHtmlEntities(ld?.organizer?.email));
		push(normalizeUrl(ld?.organizer?.url) || normalizeUrl(ld?.organizer?.sameAs));
		push(decodeHtmlEntities(ld?.organizer?.telephone));
		push(normalizeUrl(ld?.location?.sameAs));

		const $ = cheerio.load(html);
		push(
			normalizeUrl(
				$(`.tribe-organizer-email a`).first().attr(`href`)?.replace(/^mailto:/i, ``),
			),
		);
		push(normalizeUrl($(`.tribe-organizer-url a`).first().attr(`href`)));
		push(superTrimText($(`.tribe-organizer-tel`).first().text()));

		return contacts;
	}

	private async restEventToScrapedEvent(restEvent: TribeEvent): Promise<ScrapedEvent | undefined> {
		const name = decodeHtmlEntities(restEvent.title);
		if (!name) {
			console.error(`Skipping event ${restEvent.id}: missing name`);
			return undefined;
		}

		const timezone = restEvent.timezone?.trim() || DEFAULT_TIMEZONE;
		const startAt = this.extractStartAtFromRest(restEvent, timezone);
		if (!startAt) {
			console.error(`Skipping event ${restEvent.id} (${name}): missing start date`);
			return undefined;
		}

		const sourceUrl = restEvent.url?.trim();
		if (!sourceUrl) {
			console.error(`Skipping event ${restEvent.id} (${name}): missing url`);
			return undefined;
		}

		let html: string | undefined;
		try {
			console.error(`Fetching detail page: ${sourceUrl}`);
			html = await customFetch(sourceUrl, { returnType: `text` });
		} catch (error) {
			console.error(`Detail page fetch failed for ${sourceUrl}, using API data only:`, error);
		}

		const detailStartAt = html ? this.extractStartAt(html) : undefined;
		const detailEndAt = html ? this.extractEndAt(html) : undefined;

		const imageUrls = uniqueUrls([
			...(html ? this.extractImageUrls(html) ?? [] : []),
			...this.extractImageUrlsFromRest(restEvent),
		]);

		const description =
			(html ? this.extractDescription(html) : undefined) ||
			cleanProseHtml(restEvent.description || ``) ||
			undefined;

		return this.toScrapedEvent({
			name,
			startAt: detailStartAt || startAt,
			endAt: detailEndAt || this.extractEndAtFromRest(restEvent, timezone),
			address:
				(html ? this.extractAddress(html) : undefined)?.length
					? this.extractAddress(html)!
					: this.extractAddressFromRest(restEvent),
			price: this.extractPriceFromRest(restEvent) || (html ? this.extractPrice(html) : undefined),
			description,
			imageUrls,
			host: this.extractHostFromRest(restEvent) || (html ? this.extractHost(html) : undefined),
			hostLink:
				this.extractHostLinkFromRest(restEvent) || (html ? this.extractHostLink(html) : undefined),
			contact: uniqueStrings([
				...this.extractContactFromRest(restEvent),
				...(html ? this.extractContact(html) : []),
			]),
			tags: uniqueStrings([
				...this.extractTagsFromRest(restEvent),
				...(html ? this.extractTags(html) ?? [] : []),
			]),
			sourceUrl,
			timezone,
		});
	}

	private async toScrapedEvent(args: {
		name: string;
		startAt: string;
		endAt?: string | null;
		address: string[];
		price?: string | null;
		description?: string | null;
		imageUrls: string[];
		host?: string | null;
		hostLink?: string | null;
		contact: string[];
		tags: string[];
		sourceUrl: string;
		timezone?: string | null;
	}): Promise<ScrapedEvent> {
		const address = args.address;
		let latitude: number | null = null;
		let longitude: number | null = null;
		let timezone = args.timezone || DEFAULT_TIMEZONE;

		if (address?.length) {
			try {
				const geocoded = await geocodeAddressCached({
					addressLines: address,
					apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
				});
				latitude = geocoded?.lat ?? null;
				longitude = geocoded?.lng ?? null;
				timezone = geocoded?.timezone ?? timezone;
			} catch (error) {
				console.error(`Geocoding failed for ${args.sourceUrl}:`, error);
			}
		}

		const hostLink = args.hostLink || undefined;
		const contact = args.contact.filter((item) => !sameContactLink(item, hostLink));

		return {
			name: args.name,
			startAt: args.startAt,
			endAt: args.endAt,
			address,
			price: args.price,
			priceIsHtml: false,
			description: args.description,
			imageUrls: args.imageUrls,
			host: args.host,
			hostLink,
			contact,
			latitude,
			longitude,
			timezone,
			tags: args.tags,
			sourceUrl: args.sourceUrl,
			source: SOURCE,
		} satisfies ScrapedEvent;
	}

	private async fetchUpcomingEvents(): Promise<TribeEvent[]> {
		const events: TribeEvent[] = [];
		const nowUtc = new Date().toISOString().slice(0, 19).replace(`T`, ` `);
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages) {
			const params = new URLSearchParams({
				page: String(page),
				per_page: String(PER_PAGE),
				// Events that have not ended yet (includes multi-day festivals already underway).
				ends_after: nowUtc,
				status: `publish`,
			});
			const body = (await customFetch(`${EVENTS_API}?${params}`, {
				returnType: `json`,
			})) as TribeEventsListResponse;

			totalPages = body.total_pages || 1;
			if (body.events?.length) {
				for (const event of body.events) {
					if (!this.isFutureRestEvent(event)) continue;
					events.push(event);
				}
			}

			console.error(`  API page ${page}/${totalPages} — ${events.length} future events`);
			page++;
			if (page <= totalPages) await sleep(100);
		}

		return events;
	}

	private isFutureRestEvent(event: TribeEvent): boolean {
		const endUtc = event.utc_end_date || event.utc_start_date;
		if (endUtc) return parseTribeUtcDateTime(endUtc).getTime() >= Date.now();

		const endLocal = event.end_date || event.start_date;
		if (!endLocal) return true;
		return parseTribeLocalDateTime(endLocal).getTime() >= Date.now();
	}

	private extractStartAtFromRest(event: TribeEvent, timezone: string): string | undefined {
		return tribeDateToIso(event.start_date_details, timezone);
	}

	private extractEndAtFromRest(event: TribeEvent, timezone: string): string | undefined {
		const start = tribeDateToIso(event.start_date_details, timezone);
		const end = tribeDateToIso(event.end_date_details, timezone);
		if (!end) return undefined;
		if (end === start) return undefined;
		return end;
	}

	private extractAddressFromRest(event: TribeEvent): string[] {
		const venue = event.venue;
		if (!venue) return [];

		const lines: string[] = [];
		const name = decodeHtmlEntities(venue.venue);
		if (name) lines.push(name);

		const street = decodeHtmlEntities(venue.address);
		if (street) lines.push(street);

		const cityLine = [venue.zip, venue.city]
			.map((part) => decodeHtmlEntities(part))
			.filter(Boolean)
			.join(` `);
		if (cityLine) lines.push(cityLine);

		const region = decodeHtmlEntities(venue.province || venue.stateprovince);
		if (region && !cityLine.includes(region)) lines.push(region);

		const country = decodeHtmlEntities(venue.country);
		if (country) lines.push(country);

		return lines;
	}

	private extractPriceFromRest(event: TribeEvent): string | undefined {
		const cost = decodeHtmlEntities(event.cost);
		return cost || undefined;
	}

	private extractHostFromRest(event: TribeEvent): string | undefined {
		const organizer = event.organizer?.[0];
		return decodeHtmlEntities(organizer?.organizer);
	}

	private extractHostLinkFromRest(event: TribeEvent): string | undefined {
		const organizer = event.organizer?.[0];
		const website = normalizeUrl(organizer?.website) || normalizeUrl(event.website);
		if (website && !isBaliBuddiesUrl(website)) return website;
		return website || undefined;
	}

	private extractContactFromRest(event: TribeEvent): string[] {
		const contacts: string[] = [];
		const seen = new Set<string>();
		const push = (value: string | undefined) => {
			const cleaned = value?.trim();
			if (!cleaned) return;
			if (seen.has(cleaned)) return;
			seen.add(cleaned);
			contacts.push(cleaned);
		};

		const organizer = event.organizer?.[0];
		push(decodeHtmlEntities(organizer?.email));
		push(normalizeUrl(organizer?.website));
		push(decodeHtmlEntities(organizer?.phone));
		push(normalizeUrl(event.website));
		push(normalizeUrl(event.venue?.website));
		push(decodeHtmlEntities(event.venue?.phone));

		return contacts;
	}

	private extractTagsFromRest(event: TribeEvent): string[] {
		const tags = new Set<string>();
		for (const category of event.categories ?? []) {
			const name = decodeHtmlEntities(category.name);
			if (name) tags.add(name);
		}
		for (const tag of event.tags ?? []) {
			const name = decodeHtmlEntities(tag.name);
			if (name) tags.add(name);
		}
		return [...tags];
	}

	private extractImageUrlsFromRest(event: TribeEvent): string[] {
		const url = event.image?.url?.trim();
		return url ? [url] : [];
	}

	private extractDatesFromDom(html: string): { startAt?: string; endAt?: string } {
		const $ = cheerio.load(html);

		const startDatetimeTitle = $(`.tribe-events-start-datetime`).attr(`title`);
		const endDatetimeTitle = $(`.tribe-events-end-datetime`).attr(`title`);
		const startDatetimeText = superTrimText($(`.tribe-events-start-datetime`).text());
		const endDatetimeText = superTrimText($(`.tribe-events-end-datetime`).text());

		if (startDatetimeTitle && startDatetimeText) {
			const startAt = parseDomDateTitle({
				title: startDatetimeTitle,
				text: startDatetimeText,
			});
			const endAt =
				endDatetimeTitle && endDatetimeText
					? parseDomDateTitle({ title: endDatetimeTitle, text: endDatetimeText })
					: undefined;
			if (startAt) {
				return {
					startAt,
					endAt: endAt && endAt !== startAt ? endAt : undefined,
				};
			}
		}

		const dateTitle = $(`.tribe-events-start-date`).attr(`title`);
		const timeText = superTrimText($(`.tribe-events-start-time`).text());
		if (!dateTitle) return {};

		const timeMatch = timeText?.match(
			/(\d{1,2}:\d{2})\s*(?:am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2})\s*(?:am|pm)?/i,
		);
		const rangeAmPm = timeText?.match(
			/(\d{1,2}:\d{2})\s*(am|pm)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2})\s*(am|pm)/i,
		);
		if (rangeAmPm) {
			const startAt = isoFromYmdAndAmPm({
				ymd: dateTitle,
				time: rangeAmPm[1],
				meridiem: rangeAmPm[2],
			});
			const endAt = isoFromYmdAndAmPm({
				ymd: dateTitle,
				time: rangeAmPm[3],
				meridiem: rangeAmPm[4],
			});
			return {
				startAt,
				endAt: endAt && endAt !== startAt ? endAt : undefined,
			};
		}

		const singleAmPm = timeText?.match(/(\d{1,2}:\d{2})\s*(am|pm)/i);
		if (singleAmPm) {
			return {
				startAt: isoFromYmdAndAmPm({
					ymd: dateTitle,
					time: singleAmPm[1],
					meridiem: singleAmPm[2],
				}),
			};
		}

		const startTime = timeMatch?.[1] || timeText?.match(/(\d{1,2}:\d{2})/)?.[1] || `00:00`;
		const endTime = timeMatch?.[2];
		const startAt = isoFromYmdAndTime({ ymd: dateTitle, time: startTime });
		const endAt = endTime ? isoFromYmdAndTime({ ymd: dateTitle, time: endTime }) : undefined;

		return {
			startAt,
			endAt: endAt && endAt !== startAt ? endAt : undefined,
		};
	}

	private getLdEvent(html: string): LdEvent | undefined {
		const $ = cheerio.load(html);
		for (const el of $(`script[type="application/ld+json"]`).toArray()) {
			try {
				const raw = $(el).html()?.trim();
				if (!raw) continue;
				const parsed = JSON.parse(raw) as unknown;
				const found = findLdEvent(parsed);
				if (found) return found;
			} catch {
				// Some TEC pages ship an empty ld+json block — ignore and fall back.
			}
		}
		return undefined;
	}
}

function findLdEvent(value: unknown): LdEvent | undefined {
	if (!value) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findLdEvent(item);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value !== `object`) return undefined;

	const obj = value as Record<string, unknown> & LdEvent;
	const type = obj[`@type`];
	if (type === `Event` || (Array.isArray(type) && type.includes(`Event`))) return obj;
	if (`@graph` in obj) return findLdEvent(obj[`@graph`]);

	for (const nested of Object.values(obj)) {
		if (nested && typeof nested === `object`) {
			const found = findLdEvent(nested);
			if (found) return found;
		}
	}
	return undefined;
}

function isFutureScrapedEvent(event: Pick<ScrapedEvent, `startAt` | `endAt`>): boolean {
	const relevant = event.endAt || event.startAt;
	return new Date(relevant).getTime() >= Date.now();
}

function sameContactLink(contact: string, hostLink: string | undefined): boolean {
	if (!hostLink) return false;
	const normalize = (value: string) => value.trim().replace(/\/+$/, ``).toLowerCase();
	return normalize(contact) === normalize(hostLink);
}

function isBaliBuddiesUrl(url: string): boolean {
	return /balibuddies\.com/i.test(url);
}

function parseTribeUtcDateTime(value: string): Date {
	return new Date(`${value.trim().replace(` `, `T`)}Z`);
}

function parseTribeLocalDateTime(value: string): Date {
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
	if (!match) return new Date(value);
	return new Date(
		dateToIsoStr(
			Number(match[1]),
			Number(match[2]),
			Number(match[3]),
			Number(match[4]),
			Number(match[5]),
			DEFAULT_TIMEZONE,
			false,
		),
	);
}

function tribeDateToIso(
	details: TribeDateDetails | undefined,
	timezone: string,
): string | undefined {
	if (!details?.year || !details.month || !details.day) return undefined;
	const year = Number(details.year);
	const month = Number(details.month);
	const day = Number(details.day);
	const hour = Number(details.hour || 0);
	const minute = Number(details.minutes || 0);
	if (![year, month, day, hour, minute].every(Number.isFinite)) return undefined;

	return dateToIsoStr(year, month, day, hour, minute, timezone, false);
}

function parseDomDateTitle(args: { title: string; text: string }): string | undefined {
	const amPm = args.text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
	if (amPm) {
		return isoFromYmdAndAmPm({
			ymd: args.title,
			time: `${amPm[1]}:${amPm[2]}`,
			meridiem: amPm[3],
		});
	}
	const timeMatch = args.text.match(/(\d{1,2}):(\d{2})/);
	const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : `00:00`;
	return isoFromYmdAndTime({ ymd: args.title, time });
}

function isoFromYmdAndTime(args: { ymd: string; time: string }): string | undefined {
	const dateMatch = args.ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dateMatch) return undefined;
	const timeMatch = args.time.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!timeMatch) return undefined;

	return dateToIsoStr(
		Number(dateMatch[1]),
		Number(dateMatch[2]),
		Number(dateMatch[3]),
		Number(timeMatch[1]),
		Number(timeMatch[2]),
		DEFAULT_TIMEZONE,
		false,
	);
}

function isoFromYmdAndAmPm(args: {
	ymd: string;
	time: string;
	meridiem: string;
}): string | undefined {
	const dateMatch = args.ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dateMatch) return undefined;
	const timeMatch = args.time.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!timeMatch) return undefined;

	let hour = Number(timeMatch[1]);
	const minute = Number(timeMatch[2]);
	const meridiem = args.meridiem.toLowerCase();
	if (meridiem === `pm` && hour < 12) hour += 12;
	if (meridiem === `am` && hour === 12) hour = 0;

	return dateToIsoStr(
		Number(dateMatch[1]),
		Number(dateMatch[2]),
		Number(dateMatch[3]),
		hour,
		minute,
		DEFAULT_TIMEZONE,
		false,
	);
}

function pickLargestFromSrcset(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	if (!value.includes(`,`)) return value.trim();

	let bestUrl: string | undefined;
	let bestWidth = -1;
	for (const part of value.split(`,`)) {
		const [url, descriptor] = part.trim().split(/\s+/);
		if (!url) continue;
		const width = Number(descriptor?.replace(/w$/i, ``));
		if (!Number.isFinite(width)) {
			if (!bestUrl) bestUrl = url;
			continue;
		}
		if (width <= bestWidth) continue;
		bestWidth = width;
		bestUrl = url;
	}
	return bestUrl;
}

function decodeHtmlEntities(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	const decoded = value
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
		.replace(/&amp;/g, `&`)
		.replace(/&lt;/g, `<`)
		.replace(/&gt;/g, `>`)
		.replace(/&quot;/g, `"`)
		.replace(/&apos;/g, `'`)
		.replace(/&nbsp;/g, ` `)
		.replace(/&ndash;/g, `–`)
		.replace(/&mdash;/g, `—`)
		.replace(/&rsquo;/g, `'`)
		.replace(/&lsquo;/g, `'`)
		.replace(/&rdquo;/g, `"`)
		.replace(/&ldquo;/g, `"`)
		.replace(/&uuml;/g, `ü`)
		.replace(/&auml;/g, `ä`)
		.replace(/&ouml;/g, `ö`)
		.replace(/&Uuml;/g, `Ü`)
		.replace(/&Auml;/g, `Ä`)
		.replace(/&Ouml;/g, `Ö`)
		.replace(/&szlig;/g, `ß`)
		.trim();
	return decoded || undefined;
}

function normalizeUrl(value: string | undefined | null): string | undefined {
	const raw = value?.trim();
	if (!raw) return undefined;
	if (raw.startsWith(`mailto:`)) return raw.slice(`mailto:`.length).trim() || undefined;
	if (raw.startsWith(`tel:`)) return raw.slice(`tel:`.length).trim() || undefined;
	if (/^https?:\/\//i.test(raw)) return raw;
	if (raw.startsWith(`www.`)) return `https://${raw}`;
	if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(raw)) return `https://${raw}`;
	return raw;
}

function superTrimText(value: string | undefined | null): string | undefined {
	const cleaned = value?.replace(/\s+/g, ` `).trim();
	return cleaned || undefined;
}

function uniqueUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const url of urls) {
		const key = url.split(`?`)[0];
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(url);
	}
	return result;
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const key = value.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(key);
	}
	return result;
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		if (process.argv.length > 2) {
			console.log(JSON.stringify(await scraper.scrapeHtmlFiles(process.argv.slice(2)), null, 2));
		} else {
			console.log(JSON.stringify(await scraper.scrapeWebsite(), null, 2));
		}
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type TribeDateDetails = {
	year?: string;
	month?: string;
	day?: string;
	hour?: string;
	minutes?: string;
	seconds?: string;
};

type TribeEvent = {
	id: number;
	title?: string | null;
	url?: string | null;
	description?: string | null;
	cost?: string | null;
	website?: string | null;
	timezone?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	utc_start_date?: string | null;
	utc_end_date?: string | null;
	start_date_details?: TribeDateDetails;
	end_date_details?: TribeDateDetails;
	image?: { url?: string | null } | false | null;
	venue?: {
		venue?: string | null;
		address?: string | null;
		city?: string | null;
		zip?: string | null;
		country?: string | null;
		province?: string | null;
		stateprovince?: string | null;
		phone?: string | null;
		website?: string | null;
	};
	organizer?: {
		organizer?: string | null;
		email?: string | null;
		phone?: string | null;
		website?: string | null;
	}[];
	categories?: { name?: string | null }[];
	tags?: { name?: string | null }[];
};

type TribeEventsListResponse = {
	events?: TribeEvent[];
	total_pages?: number;
};

type LdEvent = {
	"@type"?: string | string[];
	name?: string;
	startDate?: string;
	endDate?: string;
	image?: string | string[];
	url?: string;
	description?: string;
	location?: {
		name?: string;
		sameAs?: string;
		address?: {
			streetAddress?: string;
			addressLocality?: string;
			addressRegion?: string;
			postalCode?: string;
			addressCountry?: string;
		};
	};
	organizer?: {
		name?: string;
		url?: string;
		sameAs?: string;
		email?: string;
		telephone?: string;
	};
	offers?: {
		price?: string | number;
		priceCurrency?: string;
	};
};
