/**
 * Scrapes events from todo.today for multiple locations (today + tomorrow).
 *
 * Today: fetches listing page HTML, extracts event URLs from DOM (currently commented out).
 * Tomorrow: uses Playwright to bypass Cloudflare, calls the REST listing API to discover
 *   event URLs, then calls tt_get_single_event AJAX for each event's detail JSON.
 *
 * Requires Bun (https://bun.sh/) and Playwright browsers installed.
 *
 * Usage:
 *   bun run scripts/scrape-todotoday.ts
 */
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	customFetch,
	WebsiteScraperInterface,
	cleanProseHtml,
	superTrim,
	dateToIsoStr,
	extractIcalStartAndEndTimes,
} from './common.ts';
import * as cheerio from 'cheerio';
import { geocodeAddressCached } from '../src/lib/server/google.ts';
import { chromium, type Page } from '@playwright/test';

const LOCATIONS = [`ubud`, `canggu`, `koh-phangan`, `pai`] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		let locationsWithEvents = 0;

		for (const location of LOCATIONS) {
			console.log(`Scraping events for ${location}...`);

			for (const day of [`today`, `tomorrow`] as const) {
				try {
					const events = await this.scrapeEventsViaBrowser({ location, day });
					if (!events.length) {
						console.warn(`No ${day} events found via API for ${location}. Continuing...`);
						continue;
					}
					locationsWithEvents += 1;
					allEvents.push(...events);
					console.log(`Collected ${events.length} ${day} events for ${location}`);
				} catch (error) {
					console.error(`Failed to scrape ${day} events for ${location}`, error);
					continue;
				}
			}
		}

		if (locationsWithEvents === 0) {
			throw new Error(`No events found! Failed to fetch API data for all locations.`);
		}

		console.log({ allEvents });
		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error('Method not implemented.' + filePath);
	}

	extractEventData(html: string, url: string): Promise<ScrapedEvent> {
		throw new Error('Method not implemented.' + html);
	}

	/**
	 * Converts a tt_get_single_event JSON response into a ScrapedEvent.
	 * Example: extractEventDataFromApi({ data: apiJson, url: `https://...`, location: `ubud` })
	 */
	private async extractEventDataFromApi(args: {
		data: TtSingleEventData;
		url: string;
		location: string;
		page: Page;
	}): Promise<ScrapedEvent | undefined> {
		const { data, url, location, page } = args;
		if (!data.name) return undefined;

		const timeZone = location === 'ubud' || location === 'canggu' ? 'Asia/Makassar' : 'Asia/Bangkok';

		const startAt = buildIsoFromApiDate({
			dateStr: data.start_date,
			timeStr: data.start_time,
			timeZone
		});
		if (!startAt) {
			console.error(`Missing start_date/start_time for ${url}`);
			return undefined;
		}

		const endAt = buildIsoFromApiDate({
			dateStr: data.start_date,
			timeStr: data.end_time,
			timeZone
		});

		const description = cleanProseHtml(data.description ?? null);

		const venueName = data.venue?.name ?? ``;
		const venueArea = data.venue?.area ?? ``;
		const address = [venueName, formatLocationName(location)].filter(Boolean);

		const host = data.creator?.name && data.creator.name.toLowerCase() !== 'todo.today'
			? data.creator.name
			: undefined;

		const coordinates = data.venue?.lat && data.venue?.lng
			? { lat: parseFloat(data.venue.lat), lng: parseFloat(data.venue.lng) }
			: await geocodeAddressCached([venueName, venueArea, formatLocationName(location)], process.env.GOOGLE_MAPS_API_KEY || '');

		let resolvedBookLink = await this.resolveBookLinkInBrowser({
			page,
			bookLink: data.book_link,
			fallbackUrl: url
		});

		const contact = [];
		if (!resolvedBookLink.startsWith('https://todo.today') && !resolvedBookLink.startsWith('todo.today')) {
			if (resolvedBookLink.includes('api.whatsapp.com')) {
				const phoneNumber = resolvedBookLink.match(/phone=(\d+)/)?.[1];
				resolvedBookLink = `https://wa.me/${phoneNumber}`;
			}
			contact.push(resolvedBookLink);
		}

		const tags = (data.categories ?? [])
			.map(cat => cat.name?.replace(/[^\w\s\-&]/g, '').trim())
			.filter(Boolean) as string[];

		return {
			name: data.name,
			description,
			imageUrls: data.images ?? [],
			startAt,
			endAt,
			address,
			price: data.price_label || undefined,
			priceIsHtml: false,
			host,
			hostLink: data.creator?.url ||  undefined,
			contact,
			latitude: coordinates?.lat,
			longitude: coordinates?.lng,
			tags,
			sourceUrl: url,
			source: 'todotoday' as const
		} satisfies ScrapedEvent;
	}

	/**
	 * Launches a fresh Playwright browser, discovers event URLs via REST API,
	 * then fetches each event's detail JSON via tt_get_single_event AJAX.
	 * Creates a completely new browser instance per location+day (and on recovery).
	 * Example: await scraper.scrapeEventsViaBrowser({ location: `koh-phangan`, day: `tomorrow` })
	 */
	private async scrapeEventsViaBrowser(args: { location: string; day: string }): Promise<ScrapedEvent[]> {
		const { location, day } = args;
		let { browser, page } = await this.launchFreshBrowser({ location, day });

		try {
			const eventUrls = await this.fetchEventUrlsFromPage(page, location);
			if (!eventUrls.length) return [];
			console.log(`[${location}/${day}] Found ${eventUrls.length} event URLs`);

			const events: ScrapedEvent[] = [];
			for (const eventUrl of eventUrls) {
				try {
					const parsed = parseEventUrl(eventUrl);
					if (!parsed) {
						console.warn(`[${location}/${day}] Could not parse event URL: ${eventUrl}`);
						continue;
					}

					const eventData = await this.fetchSingleEventFromPage(page, parsed);
					if (!eventData) {
						console.warn(`[${location}/${day}] No data returned for ${eventUrl}`);
						continue;
					}

					const event = await this.extractEventDataFromApi({
						data: eventData,
						url: eventUrl,
						location,
						page
					});
					if (event) {
						events.push(event);
						console.log("extracted event", event);
					}
				} catch (error) {
					console.error(`[${location}/${day}] Failed to process ${eventUrl}, recovering with fresh browser...`, error);
					try { await page.close(); } catch { /* already dead */ }
					try { await browser.close(); } catch { /* already dead */ }
					({ browser, page } = await this.launchFreshBrowser({ location, day }));
				}
			}

			return events;
		} finally {
			try { await page.close(); } catch { /* already dead */ }
			try { await browser.close(); } catch { /* already dead */ }
		}
	}

	/**
	 * Launches a completely fresh Playwright browser and navigates to the listing page.
	 * Example: const { browser, page } = await scraper.launchFreshBrowser({ location: `ubud`, day: `today` })
	 */
	private async launchFreshBrowser(args: { location: string; day: string }): Promise<{ browser: Awaited<ReturnType<typeof chromium.launch>>; page: Page }> {
		const { location, day } = args;
		const browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({
			userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`
		});
		console.log(`[${location}/${day}] Opening page in fresh browser...`);
		await page.goto(`https://todo.today/${location}/${day}/`, {
			waitUntil: `domcontentloaded`,
			timeout: 60000
		});
		await page.waitForSelector(`#tt-app`, { timeout: 60000 });
		return { browser, page };
	}

	/**
	 * Calls the REST listing API from within a Playwright page context.
	 * Example: await scraper.fetchEventUrlsFromPage(page, `ubud`)
	 */
	private async fetchEventUrlsFromPage(page: Page, location: string): Promise<string[]> {
		const appConfig = await page.evaluate(() => {
			const app = document.querySelector(`#tt-app`);
			if (!app) return null;
			return {
				restUrl: app.getAttribute(`data-rest-url`),
				restNonce: app.getAttribute(`data-rest-nonce`),
				channel: app.getAttribute(`data-channel`),
				eventDate: app.getAttribute(`data-event-date`) ?? `tomorrow`
			};
		});

		if (!appConfig?.restUrl || !appConfig.restNonce || !appConfig.channel) {
			throw new Error(`Missing tt-app rest attributes for ${location}`);
		}

		const safeConfig = {
			restUrl: appConfig.restUrl,
			restNonce: appConfig.restNonce,
			channel: appConfig.channel,
			eventDate: appConfig.eventDate
		};

		const apiResponse = await page.evaluate(async ({ config }) => {
			const params = new URLSearchParams({
				channel: config.channel,
				event_date: config.eventDate
			});
			const res = await fetch(`${config.restUrl}?${params.toString()}`, {
				headers: {
					'X-WP-Nonce': config.restNonce,
					'X-Requested-With': `XMLHttpRequest`,
					Accept: `application/json, text/plain, */*`
				}
			});
			if (!res.ok) return { ok: false as const, status: res.status, body: await res.text() };
			return { ok: true as const, payload: await res.json() };
		}, { config: safeConfig });

		if (!apiResponse.ok) {
			throw new Error(`REST API returned ${apiResponse.status} for ${location}: ${apiResponse.body?.slice(0, 200)}`);
		}

		const sections = apiResponse.payload?.sections;
		if (!sections?.length) return [];

		const urls = new Set<string>();
		for (const section of sections) {
			if (!section?.events?.length) continue;
			for (const ev of section.events) {
				if (ev?.link) urls.add(ev.link);
			}
		}
		return [...urls];
	}

	/**
	 * Calls tt_get_single_event AJAX from within a Playwright page context.
	 * Example: await scraper.fetchSingleEventFromPage(page, { location: `ubud`, year: `2026`, month: `03`, day: `03`, slug: `mat-flex-22` })
	 */
	private async fetchSingleEventFromPage(page: Page, params: ParsedEventUrl): Promise<TtSingleEventData | null> {
		const result = await page.evaluate(async ({ params }) => {
			const formData = new FormData();
			formData.append('action', 'tt_get_single_event');
			formData.append('location', params.location);
			formData.append('year', params.year);
			formData.append('month', params.month);
			formData.append('day', params.day);
			formData.append('slug', params.slug);

			const res = await fetch('/wp-admin/admin-ajax.php', {
				method: 'POST',
				body: formData,
				credentials: 'same-origin'
			});
			if (!res.ok) return { ok: false as const, status: res.status };
			const json = await res.json();
			if (!json.success || !json.data) return { ok: false as const, status: res.status };
			return { ok: true as const, data: json.data };
		}, { params });

		if (!result.ok) return null;
		return result.data as TtSingleEventData;
	}

	/**
	 * Resolves a booking link by navigating to it in a temporary browser page and returns the final URL.
	 * Example: await scraper.resolveBookLinkInBrowser({ page, bookLink: `https://example.com/r`, fallbackUrl: `https://todo.today/...` })
	 */
	private async resolveBookLinkInBrowser(args: {
		page: Page;
		bookLink?: string;
		fallbackUrl: string;
	}): Promise<string> {
		if (!args.bookLink) return args.fallbackUrl;
		const sanitizedBookLink = args.bookLink.replace('TODOTODAY', '').trim();
		if (!sanitizedBookLink) return args.fallbackUrl;

		const browser = args.page.context().browser();
		if (!browser) return sanitizedBookLink;
		const resolverContext = await browser.newContext({
			userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`
		});
		const resolverPage = await resolverContext.newPage();
		try {
			await resolverPage.goto(sanitizedBookLink, {
				waitUntil: `domcontentloaded`,
				timeout: 60000
			});
			return resolverPage.url();
		} catch (error) {
			console.error(`Failed resolving book_link ${sanitizedBookLink}`, error);
			return sanitizedBookLink;
		} finally {
			try { await resolverPage.close(); } catch { /* already dead */ }
			try { await resolverContext.close(); } catch { /* already dead */ }
		}
	}

	extractName(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractStartAt(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractEndAt(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractAddress(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractPrice(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractDescription(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractImageUrls(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractHost(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractHostLink(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractTags(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
}

// Execute the main function only when run directly
if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		await scraper.scrapeWebsite();
	} catch (error) {
		console.error('Unhandled error in main execution:', error);
		process.exit(1);
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function login() {
	const username = process.env.TODOTODAY_EMAIL!;
	const password = process.env.TODOTODAY_PASSWORD!;
	if (!username || !password) {
		throw new Error('TODOTODAY_EMAIL and TODOTODAY_PASSWORD environment variables must be set');
	}

	const resNonce = await customFetch('https://todo.today/my-account', { returnType: 'text' });
	const nonce = resNonce.match(/events_front_login\s*=\s*\{[^}]*"nonce":"([^"]+)"/)?.[1];
	console.log({ nonce });
	if (!nonce || nonce.length !== 10) {
		throw new Error('No valid nonce found for todo.today');
	}
	const res = await fetch('https://todo.today/wp-admin/admin-ajax.php', {
		method: 'POST',
		headers: {
			accept: 'application/json, text/javascript, */*; q=0.01',
			'cache-control': 'no-cache',
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
		},
		body: new URLSearchParams({
			action: 'ajax_login',
			username,
			password,
			security: nonce
		})
	});
	const authCookie =
		res.headers
			.getAll('set-cookie')
			?.find((cookie) => {
				const [key] = cookie.split('=');
				return key.trim().startsWith('wordpress_logged_in_');
			})
			?.split(';')[0] ?? '';
	console.log({ authCookie });
	return authCookie;
}

/**
 * Parses a todo.today event URL into its path components.
 * Example: parseEventUrl(`https://todo.today/ubud/2026/03/03/mat-flex-22`) // { location: `ubud`, year: `2026`, month: `03`, day: `03`, slug: `mat-flex-22` }
 */
function parseEventUrl(url: string): ParsedEventUrl | null {
	const match = url.match(/todo\.today\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^/?#]+)/);
	if (!match) return null;
	return {
		location: match[1],
		year: match[2],
		month: match[3],
		day: match[4],
		slug: match[5]
	};
}

/**
 * Builds an ISO date string from the API's start_date (YYYY-MM-DD) and time (HH:mm or h:mm AM/PM).
 * Example: buildIsoFromApiDate({ dateStr: `2026-03-03`, timeStr: `9:00 AM`, timeZone: `Asia/Makassar` })
 */
function buildIsoFromApiDate(args: { dateStr?: string; timeStr?: string; timeZone: string }): string | undefined {
	if (!args.dateStr) return undefined;

	const dateParts = args.dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dateParts) return undefined;

	const year = parseInt(dateParts[1]);
	const month = parseInt(dateParts[2]);
	const day = parseInt(dateParts[3]);

	let hour = 0;
	let minute = 0;

	if (args.timeStr) {
		const time24 = args.timeStr.match(/^(\d{1,2}):(\d{2})$/);
		const time12 = args.timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

		if (time24) {
			hour = parseInt(time24[1]);
			minute = parseInt(time24[2]);
		} else if (time12) {
			hour = parseInt(time12[1]);
			minute = parseInt(time12[2]);
			const isPM = time12[3].toUpperCase() === 'PM';
			if (isPM && hour !== 12) hour += 12;
			if (!isPM && hour === 12) hour = 0;
		}
	}

	return dateToIsoStr(year, month, day, hour, minute, args.timeZone as Parameters<typeof dateToIsoStr>[5], false);
}

function formatLocationName(location: string): string {
	return location
		.replace(/-/g, ' ')
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

type ParsedEventUrl = {
	location: string;
	year: string;
	month: string;
	day: string;
	slug: string;
};

type TtSingleEventData = {
	name?: string;
	description?: string;
	images?: string[];
	start_date?: string;
	start_time?: string;
	end_time?: string;
	display_date_time?: string;
	display_date_long?: string;
	formatted_date?: string;
	venue?: {
		name?: string;
		type?: string;
		area?: string;
		lat?: string;
		lng?: string;
		google_map_link?: string;
	};
	price_label?: string;
	creator?: {
		name?: string;
		url?: string;
	};
	book_link?: string;
	book_label?: string;
	categories?: Array<{ name?: string; emoji?: string }>;
	featured_label?: { text?: string; color?: string; font_color?: string };
	status?: string;
	is_past?: boolean;
	recurring?: string;
	related_events?: unknown[];
};
