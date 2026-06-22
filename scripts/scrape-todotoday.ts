/**
 * Scrapes events from todo.today for multiple locations (today + tomorrow).
 *
 * Two-pass approach:
 * 1. Uses Playwright to bypass Cloudflare, calls the REST listing API for event metadata.
 * 2. Fetches descriptions by launching fresh browsers per event (Cloudflare rate-limits
 *    to ~1 page fetch per session, so each event needs its own browser instance).
 *    Browsers run in parallel batches for speed.
 *
 * Requires Bun (https://bun.sh/) and Playwright browsers installed.
 *
 * Usage:
 *   bun run scripts/scrape-todotoday.ts
 */
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	TimeZoneString,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';
import { chromium, type Page } from '@playwright/test';
import * as cheerio from 'cheerio';

const DEFAULT_LOCATIONS = [`ubud`, `canggu`, `koh-phangan`, `pai`] as const;
const LOCATIONS = process.env.TODOTODAY_LOCATIONS
	? process.env.TODOTODAY_LOCATIONS.split(`,`).map((location) => location.trim()).filter(Boolean)
	: [...DEFAULT_LOCATIONS];
const DESC_PARALLEL_BROWSERS = 1;
const DESC_MAX_RETRIES = 3;
const DESC_TIMEOUT_MS = 20_000;
const CONTACT_RESOLVE_MAX_RETRIES = 3;
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`;
const REDIRECT_FETCH_TIMEOUT_MS = 15_000;
const TIMEOUT_MS = {
	perLocationDay: 3 * 60_000,
	browserLaunch: 90_000,
	listingFetch: 45_000,
	closeResource: 10_000
} as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		let locationsWithEvents = 0;
		let currentPhase = `initializing`;
		const startedAt = Date.now();
		const heartbeatId = setInterval(() => {
			const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
			console.warn(`[heartbeat] running ${elapsedSeconds}s | phase=${currentPhase} | collected=${allEvents.length}`);
		}, 30_000);

		try {
			for (const location of LOCATIONS) {
				console.log(`Scraping events for ${location}...`);

				for (const day of [`today`, `tomorrow`] as const) {
					try {
						currentPhase = `${location}/${day}`;
						console.log(`[${location}/${day}] Starting scrapeEventsViaBrowser`);
						const events = await withTimeout({
							label: `scrapeEventsViaBrowser ${location}/${day}`,
							timeoutMs: TIMEOUT_MS.perLocationDay,
							task: async () => this.scrapeEventsViaBrowser({ location, day })
						});
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

			currentPhase = `descriptions`;
			console.log(`--- Enriching ${allEvents.length} events with descriptions (${DESC_PARALLEL_BROWSERS} parallel browsers) ---`);
			await this.enrichDescriptions(allEvents);
			const withDesc = allEvents.filter(e => e.description).length;
			console.log(`--- Descriptions: ${withDesc}/${allEvents.length} events enriched ---`);

			console.log({ allEvents });
			console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
			return allEvents;
		} finally {
			clearInterval(heartbeatId);
		}
	}

	scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error('Method not implemented.' + filePath);
	}

	extractEventData(html: string, url: string): Promise<ScrapedEvent> {
		throw new Error('Method not implemented.' + html + url);
	}

	/**
	 * Launches a fresh Playwright browser, fetches all events from the REST listing API,
	 * and converts them to ScrapedEvents.
	 * Example: await scraper.scrapeEventsViaBrowser({ location: `koh-phangan`, day: `tomorrow` })
	 */
	private async scrapeEventsViaBrowser(args: { location: string; day: string }): Promise<ScrapedEvent[]> {
		const { location, day } = args;
		console.log(`[${location}/${day}] Launching fresh browser`);
		const { browser, context, page } = await withTimeout({
			label: `launchFreshBrowser ${location}/${day}`,
			timeoutMs: TIMEOUT_MS.browserLaunch,
			task: async () => this.launchFreshBrowser({ location, day })
		});

		try {
			console.log(`[${location}/${day}] Fetching events from listing API`);
			const listingEvents = await withTimeout({
				label: `fetchListingEventsFromPage ${location}/${day}`,
				timeoutMs: TIMEOUT_MS.listingFetch,
				task: async () => this.fetchListingEventsFromPage({ page, location })
			});
			if (!listingEvents.length) return [];
			console.log(`[${location}/${day}] Found ${listingEvents.length} events`);

			const timeZone: TimeZoneString = location === 'ubud' || location === 'canggu' ? 'Asia/Makassar' : 'Asia/Bangkok';
			const events: ScrapedEvent[] = [];
			for (const listingEvent of listingEvents) {
				try {
					const event = await this.extractEventFromListing({
						event: listingEvent,
						location,
						timeZone,
						page
					});
					if (event) {
						events.push(event);
					}
				} catch (error) {
					console.error(`[${location}/${day}] Failed to extract event ${listingEvent.slug}`, error);
				}
			}

			console.log(`[${location}/${day}] Extracted ${events.length}/${listingEvents.length} events`);
			return events;
		} finally {
			await closeBrowserSession({
				labelPrefix: `${location}/${day}`,
				session: { browser, context, page }
			});
		}
	}

	/**
	 * Launches a completely fresh Playwright browser and navigates to the listing page.
	 * Example: const { browser, page } = await scraper.launchFreshBrowser({ location: `ubud`, day: `today` })
	 */
	private async launchFreshBrowser(args: { location: string; day: string }): Promise<BrowserSession> {
		const { location, day } = args;
		return createBrowserSession({
			url: `https://todo.today/${location}/${day}/`,
			waitForSelector: `#tt-app`,
			gotoTimeoutMs: 60_000,
			selectorTimeoutMs: 60_000
		});
	}

	/**
	 * Calls the REST listing API from within a Playwright page context.
	 * Example: await scraper.fetchListingEventsFromPage({ page, location: `ubud` })
	 */
	private async fetchListingEventsFromPage(args: {
		page: Page;
		location: string;
	}): Promise<TtListingEvent[]> {
		const { page, location } = args;
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
			// Check if Cloudflare is blocking the request
			if (apiResponse.status === 403 && apiResponse.body?.includes('Just a moment')) {
				throw new Error(
					`Cloudflare Turnstile blocking REST API for ${location}. ` +
					`The site has implemented bot protection. ` +
					`Status: ${apiResponse.status}. ` +
					`Body: ${apiResponse.body?.slice(0, 200)}`
				);
			}
			throw new Error(`REST API returned ${apiResponse.status} for ${location}: ${apiResponse.body?.slice(0, 200)}`);
		}

		const sections = apiResponse.payload?.sections;
		if (!sections?.length) return [];

		const events: TtListingEvent[] = [];
		const seenLinks = new Set<string>();
		for (const section of sections) {
			if (!section?.events?.length) continue;
			for (const ev of section.events) {
				if (!ev?.link || seenLinks.has(ev.link)) continue;
				seenLinks.add(ev.link);
				events.push(ev);
			}
		}
		return events;
	}

	/**
	 * Calls tt_get_single_event from within the listing page context to fetch full event details.
	 * Example: await scraper.fetchSingleEventFromPage({ page, params: parsedUrl })
	 */
	private async fetchSingleEventFromPage(args: {
		page: Page;
		params: ParsedEventUrl;
	}): Promise<TtSingleEventData | null> {
		const { page, params } = args;
		const result = await page.evaluate(async ({ params }) => {
			const formData = new FormData();
			formData.append(`action`, `tt_get_single_event`);
			formData.append(`location`, params.location);
			formData.append(`year`, params.year);
			formData.append(`month`, params.month);
			formData.append(`day`, params.day);
			formData.append(`slug`, params.slug);

			const res = await fetch(`/wp-admin/admin-ajax.php`, {
				method: `POST`,
				body: formData,
				credentials: `same-origin`
			});
			if (!res.ok) return { ok: false as const };
			const json = await res.json();
			console.log({ json });
			if (!json.success || !json.data) return { ok: false as const };
			return { ok: true as const, data: json.data };
		}, { params });

		if (!result.ok) return null;
		return result.data as TtSingleEventData;
	}

	/**
	 * Resolves book links that redirect through todo.today and normalizes known contact links.
	 * Example: await scraper.resolveBookLinkInBrowser({ page, bookLink: data.book_link, fallbackUrl: url })
	 */
	private async resolveBookLinkInBrowser(args: {
		page: Page;
		bookLink?: string;
	}): Promise<string | undefined> {
		const { page, bookLink } = args;
		if (!bookLink) return undefined;

		const context = page.context();
		const resolverPage = await context.newPage();
		try {
			await resolverPage.route(`**/*`, (route) => {
				const resourceType = route.request().resourceType();
				if (resourceType === `image` || resourceType === `media` || resourceType === `font` || resourceType === `stylesheet`) {
					void route.abort();
					return;
				}
				void route.continue();
			});

			await resolverPage.goto(bookLink, {
				waitUntil: `commit`,
				timeout: 15_000
			});

			if (resolverPage.url().includes(`todo.today/go/`)) {
				try {
					await resolverPage.waitForURL((url) => !url.href.includes(`todo.today/go/`), { timeout: 10_000 });
				} catch {
					// Keep unresolved URL fallback behavior.
				}
			}

			return resolverPage.url() || bookLink;
		} catch {
			return bookLink;
		} finally {
			await closeWithTimeout({
				label: `resolver page.close ${bookLink}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => resolverPage.close()
			});
		}
	}

	/**
	 * Converts a REST listing API event into a ScrapedEvent.
	 * Example: await scraper.extractEventFromListing({ event: listingEvent, location: `ubud`, timeZone: `Asia/Makassar` })
	 */
	private async extractEventFromListing(args: {
		event: TtListingEvent;
		location: string;
		timeZone: TimeZoneString;
		page: Page;
	}): Promise<ScrapedEvent | undefined> {
		const { event, location, timeZone, page } = args;
		if (!event.name || !event.link) return undefined;

		const parsed = parseEventUrl(event.link);
		if (!parsed) return undefined;

		const dateStr = `${parsed.year}-${parsed.month}-${parsed.day}`;
		const startAt = buildIsoFromApiDate({ dateStr, timeStr: event.start_time ?? undefined, timeZone });
		if (!startAt) return undefined;

		const endAt = buildIsoFromApiDate({ dateStr, timeStr: event.end_time ?? undefined, timeZone });

		let detailData: TtSingleEventData | null = null;
		try {
			detailData = await this.fetchSingleEventFromPage({ page, params: parsed });
		} catch (error) {
			console.warn(`[detail] failed to fetch single event payload for ${event.link}`, error);
		}

		const venueName = detailData?.venue?.name?.trim() || event.venue?.trim();
		const venueArea = detailData?.venue?.area?.trim() || event.area?.trim();
		const address = [venueName, formatLocationName(location)].filter(Boolean) as string[];
		const timezoneLookup = (event.google_map || venueName || venueArea)
			? await geocodeAddressCached({
				addressLines: [venueName, venueArea, formatLocationName(location)].filter(Boolean) as string[],
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``
			})
			: null;

		let coordinates: { lat: number; lng: number } | null | undefined;
		const venueLat = detailData?.venue?.lat ? Number.parseFloat(detailData.venue.lat) : undefined;
		const venueLng = detailData?.venue?.lng ? Number.parseFloat(detailData.venue.lng) : undefined;
		if (venueLat !== undefined && venueLng !== undefined && !Number.isNaN(venueLat) && !Number.isNaN(venueLng)) {
			coordinates = { lat: venueLat, lng: venueLng };
		} else if (event.google_map || venueName || venueArea) {
			coordinates = timezoneLookup;
		}

		const creatorName = detailData?.creator?.name || event.creator_name;
		const host = creatorName && creatorName.toLowerCase() !== `todo.today`
			? creatorName
			: undefined;
		const hostLink = detailData?.creator?.url?.trim() || undefined;

		let contact: string[] = [];
		if (detailData?.book_link) {
			let resolvedBookLink = await this.resolveBookLinkInBrowser({
				page,
				bookLink: detailData.book_link,
			});
			const isTodoTodayLink = resolvedBookLink?.startsWith(`https://todo.today`) || resolvedBookLink?.startsWith(`todo.today`);
			if (!isTodoTodayLink && resolvedBookLink) {
				if (resolvedBookLink?.includes(`api.whatsapp.com`)) {
					const phoneNumber = resolvedBookLink.match(/phone=(\d+)/)?.[1];
					if (phoneNumber) {
						resolvedBookLink = `https://wa.me/${phoneNumber}`;
					}
				}
				contact = [resolvedBookLink];
			}
		}

		const imageUrls = detailData?.images?.length ? detailData.images : event.image ? [event.image] : [];
		const tags = (detailData?.categories ?? [])
			.map(cat => cat.name?.replace(/[^\w\s\-&]/g, ``).trim())
			.filter((tag): tag is string => Boolean(tag));

		return {
			name: detailData?.name || event.name,
			description: null,
			imageUrls,
			startAt,
			endAt,
			address,
			price: detailData?.price_label || event.price_label || undefined,
			priceIsHtml: false,
			host,
			hostLink,
			contact,
			latitude: coordinates?.lat,
			longitude: coordinates?.lng,
			timezone: timezoneLookup?.timezone,
			tags,
			sourceUrl: event.link,
			source: 'todotoday'
		};
	}

	/**
	 * Enriches events with descriptions by launching fresh browsers in parallel batches.
	 * Events that fail (timeout, browser crash, etc.) are collected and retried up to
	 * DESC_MAX_RETRIES times with reduced parallelism on each retry round.
	 * Example: await scraper.enrichDescriptions(events)
	 */
	private async enrichDescriptions(events: ScrapedEvent[]): Promise<void> {
		let pending = events;

		for (let attempt = 0; attempt <= DESC_MAX_RETRIES; attempt++) {
			if (!pending.length) break;

			const parallelism = attempt === 0 ? DESC_PARALLEL_BROWSERS : Math.max(1, DESC_PARALLEL_BROWSERS - attempt);
			const label = attempt === 0 ? `` : ` (retry ${attempt}/${DESC_MAX_RETRIES})`;
			console.log(`[desc]${label} ${pending.length} events to enrich, parallelism=${parallelism}`);

			const failed = await this.runDescriptionBatches({ events: pending, parallelism });

			if (!failed.length) break;
			pending = failed;
			console.log(`[desc]${label} ${failed.length} events failed, will retry`);
		}
	}

	/**
	 * Runs description fetching in batches and returns events that were not enriched.
	 * Tracks all browser instances so timed-out batches can be force-killed to prevent
	 * zombie processes from exhausting OS resources.
	 * Example: const failed = await scraper.runDescriptionBatches({ events, parallelism: 3 })
	 */
	private async runDescriptionBatches(args: {
		events: ScrapedEvent[];
		parallelism: number;
	}): Promise<ScrapedEvent[]> {
		const { events, parallelism } = args;
		const batchTimeoutMs = (DESC_TIMEOUT_MS + 10_000) * 1.5;
		const failed: ScrapedEvent[] = [];
		const browsers: BrowserHandle[] = [];
		let batchBrowser: BrowserInstance | undefined;

		try {
			batchBrowser = await createTrackedBrowser({ browsers });
			for (let i = 0; i < events.length; i += parallelism) {
				const batch = events.slice(i, i + parallelism);
				const batchNum = Math.floor(i / parallelism) + 1;
				const totalBatches = Math.ceil(events.length / parallelism);
				console.log(`[desc] Batch ${batchNum}/${totalBatches} (${batch.length} events)`);

				const batchPromise = Promise.allSettled(
					batch.map((event) =>
						fetchEventPageDetails2({
							eventUrl: event.sourceUrl,
							browsers,
							sharedBrowser: batchBrowser
						})
					)
				);
				const timedResult = await raceWithTimeout({
					label: `desc batch ${batchNum}/${totalBatches}`,
					timeoutMs: batchTimeoutMs,
					task: async () => batchPromise
				});

				if (timedResult.timedOut || !timedResult.value) {
					console.warn(`[desc] Batch ${batchNum} timed out, killing ${browsers.length} browsers`);
					await killBrowsers(browsers);
					batchBrowser = await createTrackedBrowser({ browsers });
					failed.push(...batch);
					continue;
				}

				for (let j = 0; j < batch.length; j++) {
					const result = timedResult.value[j];
					if (result.status !== `fulfilled`) {
						if (isUnresolvedContactError(result.reason)) {
							throw result.reason;
						}
						failed.push(batch[j]);
						continue;
					}
					const value = result.value;
					if (!value.ok) {
						failed.push(batch[j]);
						continue;
					}
					if (value.description) batch[j].description = value.description;
					if (value.tags?.length) batch[j].tags = value.tags;
					if (value.contact?.length) batch[j].contact = value.contact;
					if (value.hostLink) batch[j].hostLink = value.hostLink;
				}
			}
		} finally {
			await killBrowsers(browsers);
		}

		return failed;
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

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		console.log(`Starting website scrape`);
		await scraper.scrapeWebsite();
		console.log(`Main execution finished, exiting with code 0`);
		process.exit(0);
	} catch (error) {
		console.error('Unhandled error in main execution:', error);
		process.exit(1);
	}
}

/**
 * Parses a todo.today event URL into its path components.
 * Example: parseEventUrl(`https://todo.today/ubud/2026/03/03/mat-flex-22`) // { location: `ubud`, year: `2026`, ... }
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
 * Builds an ISO date string from a date (YYYY-MM-DD) and time (HH:mm, HH:mm:ss, or h:mm AM/PM).
 * Example: buildIsoFromApiDate({ dateStr: `2026-03-03`, timeStr: `9:00 AM`, timeZone: `Asia/Makassar` })
 */
function buildIsoFromApiDate(args: { dateStr?: string; timeStr?: string; timeZone: TimeZoneString }): string | undefined {
	if (!args.dateStr) return undefined;

	const [year, month, day] = args.dateStr.split('-').map(Number);
	if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;

	const parsedTime = parseTimeTo24h(args.timeStr);
	if (!parsedTime) return undefined;

	return dateToIsoStr(year, month, day, parsedTime.hour, parsedTime.minute, args.timeZone, false);
}

function parseTimeTo24h(timeStr?: string): { hour: number; minute: number } | undefined {
	if (!timeStr) return undefined;
	const trimmed = timeStr.trim();
	const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
	if (amPmMatch) {
		const rawHour = Number(amPmMatch[1]);
		const minute = Number(amPmMatch[2]);
		const period = amPmMatch[3].toUpperCase();
		if (isNaN(rawHour) || isNaN(minute)) return undefined;
		let hour = rawHour % 12;
		if (period === 'PM') {
			hour += 12;
		}
		return { hour, minute };
	}

	const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
	if (!twentyFourHourMatch) return undefined;
	const hour = Number(twentyFourHourMatch[1]);
	const minute = Number(twentyFourHourMatch[2]);
	if (isNaN(hour) || isNaN(minute)) return undefined;
	return { hour, minute };
}

function formatLocationName(location: string): string {
	return location
		.replace(/-/g, ' ')
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * Runs an async task with a hard timeout and throws if the limit is exceeded.
 * Example: await withTimeout({ label: `fetch listing`, timeoutMs: 45_000, task: async () => fetchSomething() })
 */
async function withTimeout<T>(args: {
	label: string;
	timeoutMs: number;
	task: () => Promise<T>;
}): Promise<T> {
	const startedAt = Date.now();
	console.log(`[timeout] start ${args.label} (${args.timeoutMs}ms)`);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`Timed out after ${args.timeoutMs}ms: ${args.label}`));
			}, args.timeoutMs);
		});
		const result = await Promise.race([args.task(), timeoutPromise]);
		const elapsed = Date.now() - startedAt;
		console.log(`[timeout] done ${args.label} (${elapsed}ms)`);
		return result;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

/**
 * Closes a Playwright resource with timeout and never throws.
 * Example: await closeWithTimeout({ label: `finally page.close`, timeoutMs: 10_000, task: async () => page.close() })
 */
async function closeWithTimeout(args: {
	label: string;
	timeoutMs: number;
	task: () => Promise<void>;
}): Promise<void> {
	try {
		await withTimeout({
			label: args.label,
			timeoutMs: args.timeoutMs,
			task: args.task
		});
	} catch (error) {
		console.warn(`[close-timeout] ${args.label}`, error);
	}
}

/**
 * Creates a browser session (browser + context + page) and optionally performs warmup navigation.
 * Example: const session = await createBrowserSession({ url: `https://todo.today/ubud/today/`, waitForSelector: `#tt-app` })
 */
async function createBrowserSession(args: {
	url?: string;
	waitForSelector?: string;
	gotoTimeoutMs?: number;
	selectorTimeoutMs?: number;
}): Promise<BrowserSession> {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ userAgent: USER_AGENT });
	const page = await context.newPage();

	if (args.url) {
		await page.goto(args.url, {
			waitUntil: `domcontentloaded`,
			timeout: args.gotoTimeoutMs ?? 60_000
		});
	}
	if (args.waitForSelector) {
		await page.waitForSelector(args.waitForSelector, {
			timeout: args.selectorTimeoutMs ?? 60_000
		});
	}

	return { browser, context, page };
}

/**
 * Closes a browser session in safe order and never throws.
 * Example: await closeBrowserSession({ labelPrefix: `ubud/today`, session })
 */
async function closeBrowserSession(args: {
	labelPrefix: string;
	session: BrowserSession;
}): Promise<void> {
	await closeWithTimeout({
		label: `${args.labelPrefix} finally page.close`,
		timeoutMs: TIMEOUT_MS.closeResource,
		task: async () => args.session.page.close()
	});
	await closeWithTimeout({
		label: `${args.labelPrefix} finally context.close`,
		timeoutMs: TIMEOUT_MS.closeResource,
		task: async () => args.session.context.close()
	});
	await closeWithTimeout({
		label: `${args.labelPrefix} finally browser.close`,
		timeoutMs: TIMEOUT_MS.closeResource,
		task: async () => args.session.browser.close()
	});
}

/**
 * Races a task against a timeout and returns structured timeout status.
 * Example: const result = await raceWithTimeout({ label: `desc batch`, timeoutMs: 30_000, task: async () => doWork() })
 */
async function raceWithTimeout<T>(args: {
	label: string;
	timeoutMs: number;
	task: () => Promise<T>;
}): Promise<{ timedOut: true; value: null } | { timedOut: false; value: T }> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = Symbol(`timeout`);
	try {
		const timeoutPromise = new Promise<typeof timeoutResult>((resolve) => {
			timeoutId = setTimeout(() => resolve(timeoutResult), args.timeoutMs);
		});
		const result = await Promise.race([args.task(), timeoutPromise]);
		if (result === timeoutResult) {
			console.warn(`[timeout-race] Timed out after ${args.timeoutMs}ms: ${args.label}`);
			return { timedOut: true, value: null };
		}
		return { timedOut: false, value: result };
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

/**
 * Retries an async task with bounded backoff and optional jitter.
 * Example: await withRetry({ attempts: 3, task: async () => resolveSomething() })
 */
async function withRetry<T>(args: {
	attempts: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	jitterMs?: number;
	task: (attempt: number) => Promise<T>;
	shouldRetry?: (error: unknown) => boolean;
}): Promise<T> {
	const baseDelayMs = args.baseDelayMs ?? 250;
	const maxDelayMs = args.maxDelayMs ?? 1500;
	const jitterMs = args.jitterMs ?? 120;
	let lastError: unknown;

	for (let attempt = 1; attempt <= args.attempts; attempt++) {
		try {
			return await args.task(attempt);
		} catch (error) {
			lastError = error;
			if (attempt >= args.attempts) break;
			if (args.shouldRetry && !args.shouldRetry(error)) break;
			const delayNoJitter = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
			const jitter = Math.floor(Math.random() * (jitterMs + 1));
			await Bun.sleep(delayNoJitter + jitter);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(`${lastError ?? `Unknown retry error`}`);
}

/**
 * Launches Chromium and tracks it for emergency batch cleanup.
 * Example: const browser = await createTrackedBrowser({ browsers })
 */
async function createTrackedBrowser(args: {
	browsers: BrowserHandle[];
}): Promise<BrowserInstance> {
	const browser = await chromium.launch({ headless: true, timeout: 15_000 });
	args.browsers.push({ instance: browser });
	return browser;
}

/**
 * Fetches event details via tt_get_single_event and returns description metadata.
 * Example: await fetchEventPageDetails2({ eventUrl: `https://todo.today/pai/2026/03/03/full-moon-cacao-ceremony-12`, browsers })
 */
async function fetchEventPageDetails2(args: {
	eventUrl: string;
	browsers: BrowserHandle[];
	sharedBrowser?: BrowserInstance;
}): Promise<EventPageResult> {
	const { eventUrl, browsers, sharedBrowser } = args;
	const parsedEventUrl = parseEventUrl(eventUrl);
	if (!parsedEventUrl) return { ok: false };

	let browser = sharedBrowser;
	let ownsBrowser = false;
	let context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>[`newContext`]>> | undefined;
	let page: Page | undefined;
	let resolverPage: Page | undefined;

	try {
		if (!browser) {
			browser = await createTrackedBrowser({ browsers });
			ownsBrowser = true;
		}
		context = await browser.newContext({
			userAgent: USER_AGENT
		});
		page = await context.newPage();
		await page.goto(eventUrl, { waitUntil: `domcontentloaded`, timeout: DESC_TIMEOUT_MS });

		const title = await page.title();
		if (title.includes(`Just a moment`)) {
			await page.waitForFunction(() => !document.title.includes(`Just a moment`), { timeout: 8000 }).catch(() => {});
			if ((await page.title()).includes(`Just a moment`)) return { ok: false };
		}

		const detailResponse = await page.evaluate(async ({ parsedEventUrl }) => {
			const formData = new FormData();
			formData.append(`action`, `tt_get_single_event`);
			formData.append(`location`, parsedEventUrl.location);
			formData.append(`year`, parsedEventUrl.year);
			formData.append(`month`, parsedEventUrl.month);
			formData.append(`day`, parsedEventUrl.day);
			formData.append(`slug`, parsedEventUrl.slug);

			const response = await fetch(`/wp-admin/admin-ajax.php`, {
				method: `POST`,
				body: formData,
				credentials: `same-origin`,
				headers: {
					Accept: `*/*`
				}
			});

			if (!response.ok) {
				return {
					ok: false as const,
					status: response.status
				};
			}

			const json = await response.json();
			if (!json?.success || !json?.data) {
				return {
					ok: false as const,
					status: 200
				};
			}

			return {
				ok: true as const,
				data: json.data
			};
		}, { parsedEventUrl });

		if (!detailResponse.ok) {
			console.warn(`[desc2] tt_get_single_event failed for ${eventUrl} with status=${detailResponse.status}`);
			return { ok: false };
		}

		const detailData = detailResponse.data as TtSingleEventData;
		const $ = cheerio.load(detailData.description ?? '');
		$('.tt-hidden').remove(); // remove todotoday advertising
		const description = cleanProseHtml($.html());
		const tags = (detailData.categories ?? [])
			.map((category: { name?: string }) => category.name?.replace(/[^\w\s\-&]/g, ``).trim())
			.filter((tag): tag is string => Boolean(tag));

		const reserveLink = detailData.book_link?.trim() || null;
		resolverPage = await context.newPage();
		const warmupUrl = `https://todo.today/${parsedEventUrl.location}/today/`;
		await resolverPage.goto(warmupUrl, { waitUntil: `domcontentloaded`, timeout: DESC_TIMEOUT_MS });
		await resolverPage.waitForSelector(`#tt-app`, { timeout: 10_000 }).catch(() => {});
		const contact = await normalizeContactLinks({
			page: resolverPage,
			reserveLink
		});

		const hostLinkRaw = detailData.creator?.url?.trim() || undefined;
		const hostLink = hostLinkRaw
			? await resolveRedirectInPage({ page: resolverPage, url: hostLinkRaw })
			: undefined;

		return { ok: true, description, tags, contact, hostLink };
	} catch (error) {
		if (isUnresolvedContactError(error)) {
			throw error;
		}
		console.warn(`[desc2] Failed for ${eventUrl}`, error);
		return { ok: false };
	} finally {
		if (resolverPage) {
			const resolverPageToClose = resolverPage;
			await closeWithTimeout({
				label: `resolver page.close ${eventUrl}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => resolverPageToClose.close()
			});
		}
		if (page) {
			const pageToClose = page;
			await closeWithTimeout({
				label: `desc2 finally page.close ${eventUrl}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => pageToClose.close()
			});
		}
		if (context) {
			const contextToClose = context;
			await closeWithTimeout({
				label: `desc2 finally context.close ${eventUrl}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => contextToClose.close()
			});
		}
		if (ownsBrowser && browser) {
			const browserToClose = browser;
			await closeWithTimeout({
				label: `desc2 finally browser.close ${eventUrl}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => browserToClose.close()
			});
		}
	}
}

/**
 * Force-closes all tracked browser instances and waits briefly for cleanup.
 * Example: await killBrowsers(handles)
 */
async function killBrowsers(handles: BrowserHandle[]): Promise<void> {
	await Promise.allSettled(
		handles.map(async (handle, index) => {
			const browser = handle.instance;
			if (!browser) return;
			await closeWithTimeout({
				label: `killBrowsers[${index}]`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => browser.close()
			});
			handle.instance = undefined;
		})
	);
	await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * Combines reserve/contact links and resolves redirects to produce normalized contact URLs.
 * Example: await normalizeContactLinks({ page, reserveLink, firstContactLink })
 */
async function normalizeContactLinks(args: {
	page: Page;
	reserveLink: string | null;
	firstContactLink?: string;
}): Promise<string[]> {
	const rawLinks = [args.reserveLink, args.firstContactLink]
		.filter((link): link is string => Boolean(link?.trim()));
	if (!rawLinks.length) return [];

	const resolvedLinks: string[] = [];
	for (const rawLink of rawLinks) {
		let normalized = rawLink;
		try {
			normalized = await withRetry({
				attempts: CONTACT_RESOLVE_MAX_RETRIES,
				task: async (attempt) => {
					let resolved = await resolveRedirectInPage({ page: args.page, url: rawLink });
					if (resolved.includes(`api.whatsapp.com`)) {
						const phoneNumber = resolved.match(/phone=(\d+)/)?.[1];
						if (phoneNumber) resolved = `https://wa.me/${phoneNumber}`;
					}
					const unresolved = isUnresolvedContactLink({ rawLink, resolvedLink: resolved });
					if (!unresolved) return resolved;
					console.warn(`[contact] unresolved link attempt ${attempt}/${CONTACT_RESOLVE_MAX_RETRIES}: ${rawLink} -> ${resolved}`);
					throw new Error(`Unresolved contact link`);
				},
				shouldRetry: () => true
			});
		} catch {
			throw new Error(`[UNRESOLVED_CONTACT_LINK] Failed to resolve after ${CONTACT_RESOLVE_MAX_RETRIES} retries: ${rawLink}`);
		}
		resolvedLinks.push(normalized);
	}

	return [...new Set(resolvedLinks)];
}

/**
 * Resolves redirects by navigating the page to the URL and reading the final URL.
 * Uses Playwright page.goto so Cloudflare clearance is inherited from the browser context.
 * Example: await resolveRedirectInPage({ page, url: `https://todo.today/go/abcde` })
 */
async function resolveRedirectInPage(args: {
	page: Page;
	url: string;
}): Promise<string> {
	const sanitizedUrl = args.url.trim();
	const shouldResolveRedirect = sanitizedUrl.toLowerCase().includes(`todo.today/go/`);
	if (!shouldResolveRedirect) return sanitizedUrl;

	try {
		const response = await args.page.goto(sanitizedUrl, {
			waitUntil: `domcontentloaded`,
			timeout: 15_000
		});

		if (args.page.url().includes(`todo.today/go/`)) {
			await args.page.waitForURL((url) => !url.href.includes(`todo.today/go/`), { timeout: 10_000 }).catch(() => {});
		}

		let resolvedUrl = (response?.url() || args.page.url()).trim() || sanitizedUrl;
		if (resolvedUrl.toLowerCase().includes(`todo.today/go/`)) {
			const fallbackResolvedUrl = await resolveRedirectViaFetch({ url: sanitizedUrl });
			resolvedUrl = fallbackResolvedUrl;
		}
		console.log(`resolved ${sanitizedUrl} to ${resolvedUrl}`);
		return resolvedUrl;
	} catch {
		return resolveRedirectViaFetch({ url: sanitizedUrl });
	}
}

/**
 * Resolves redirects through Bun fetch as a fallback when browser navigation stays on /go/.
 * Example: await resolveRedirectViaFetch({ url: `https://todo.today/go/abcde` })
 */
async function resolveRedirectViaFetch(args: { url: string }): Promise<string> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REDIRECT_FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(args.url, {
			method: `GET`,
			redirect: `follow`,
			headers: {
				Accept: `*/*`
			},
			signal: controller.signal
		});
		const resolvedUrl = response.url?.trim();
		if (!resolvedUrl) return args.url;
		return resolvedUrl;
	} catch {
		return args.url;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Checks whether the resolved contact URL still points to unresolved todo.today redirects.
 * Example: isUnresolvedContactLink({ rawLink: `https://todo.today/go/abc`, resolvedLink: `https://todo.today/go/abc` })
 */
function isUnresolvedContactLink(args: { rawLink: string; resolvedLink: string }): boolean {
	const rawLower = args.rawLink.trim().toLowerCase();
	const resolvedLower = args.resolvedLink.trim().toLowerCase();
	const rawIsTodoToday = rawLower.includes(`todo.today`);
	const resolvedIsTodoToday = resolvedLower.includes(`todo.today`);
	const isShortRedirect = resolvedLower.includes(`todo.today/go/`);
	if (isShortRedirect) return true;
	if (rawIsTodoToday && resolvedIsTodoToday) return true;
	return false;
}

/**
 * Detects unresolved contact link errors so they can fail the scrape.
 * Example: isUnresolvedContactError(new Error(`[UNRESOLVED_CONTACT_LINK] ...`))
 */
function isUnresolvedContactError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : `${error ?? ``}`;
	return message.includes(`[UNRESOLVED_CONTACT_LINK]`);
}

type BrowserHandle = {
	instance: BrowserInstance | undefined;
};

type EventPageResult =
	| { ok: true; description: string | null; tags: string[]; contact: string[]; hostLink?: string }
	| { ok: false };

type BrowserSession = {
	browser: BrowserInstance;
	context: Awaited<ReturnType<BrowserInstance[`newContext`]>>;
	page: Page;
};

type BrowserInstance = Awaited<ReturnType<typeof chromium.launch>>;

type ParsedEventUrl = {
	location: string;
	year: string;
	month: string;
	day: string;
	slug: string;
};

type TtListingEvent = {
	id?: number;
	name?: string;
	short_name?: string;
	creator_name?: string;
	slug?: string;
	image?: string;
	link?: string;
	share_link?: string;
	display_date?: string;
	start_time?: string;
	end_time?: string;
	duration?: string;
	venue?: string;
	area?: string;
	venue_type?: string;
	google_map?: string;
	label?: string | null;
	join_label?: string;
	price_label?: string;
	ticket_type?: string;
	join_method?: string;
	status?: string;
	category_id?: number;
	type_id?: number;
};

type TtSingleEventData = {
	name?: string;
	description?: string;
	images?: string[];
	price_label?: string;
	book_link?: string;
	venue?: {
		name?: string;
		area?: string;
		lat?: string;
		lng?: string;
	};
	creator?: {
		name?: string;
		url?: string;
	};
	categories?: Array<{ name?: string }>;
};
