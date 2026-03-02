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
	dateToIsoStr,
TimeZoneString,
} from './common.ts';
import * as cheerio from 'cheerio';
import { geocodeAddressCached } from '../src/lib/server/google.ts';
import { chromium, type Page } from '@playwright/test';

const LOCATIONS = [`ubud`, `canggu`, `koh-phangan`, `pai`] as const;
const MAX_EVENT_RETRIES = 2;
const TIMEOUT_MS = {
	perLocationDay: 6 * 60_000,
	browserLaunch: 90_000,
	listingFetch: 45_000,
	singleEventFetch: 45_000,
	eventTransform: 60_000,
	closeResource: 10_000
} as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	private runStats = {
		retriedEvents: 0,
		skippedAfterRetries: 0,
		timeoutErrors: 0
	};

	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		let locationsWithEvents = 0;
		let currentPhase = `initializing`;
		this.runStats = { retriedEvents: 0, skippedAfterRetries: 0, timeoutErrors: 0 };
		const startedAt = Date.now();
		const heartbeatId = setInterval(() => {
			const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
			console.warn(
				`[heartbeat] running ${elapsedSeconds}s | phase=${currentPhase} | collected=${allEvents.length} | ` +
				`retried=${this.runStats.retriedEvents} | skipped=${this.runStats.skippedAfterRetries} | timeouts=${this.runStats.timeoutErrors}`
			);
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

			console.warn(
				`[retry-summary] Skipped ${this.runStats.skippedAfterRetries} event(s) after retry limit (${MAX_EVENT_RETRIES} retries per event). ` +
				`Retried events: ${this.runStats.retriedEvents}. Timeout errors observed: ${this.runStats.timeoutErrors}.`
			);
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

		const $ = cheerio.load(data.description ?? '');
		// Remove todo.today links and their parent <p> tags if applicable
		$('.tt-hidden').remove();		
		const description = cleanProseHtml($.html() ?? null);

		const venueName = data.venue?.name?.trim();
		const venueArea = data.venue?.area?.trim();
		const address = [venueName?.trim(), formatLocationName(location)].filter(Boolean) as string[];

		const host = data.creator?.name && data.creator.name.toLowerCase() !== 'todo.today'
			? data.creator.name
			: undefined;

		let coordinates: { lat: number; lng: number } | null | undefined;
		if (data.venue?.lat && data.venue?.lng) {
			coordinates = { lat: parseFloat(data.venue.lat), lng: parseFloat(data.venue.lng) };
		} else {
			console.log(`[${location}] Geocoding venue address`);
			coordinates = await geocodeAddressCached(
				[venueName, venueArea, formatLocationName(location)].filter(x => x) as string[],
				process.env.GOOGLE_MAPS_API_KEY || ''
			);
		}

		console.log(`[${location}] Resolving booking link for ${url}`);
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
		console.log(`[${location}/${day}] Launching fresh browser`);
		let { browser, context, page } = await withTimeout({
			label: `launchFreshBrowser ${location}/${day}`,
			timeoutMs: TIMEOUT_MS.browserLaunch,
			task: async () => this.launchFreshBrowser({ location, day })
		});

		try {
			console.log(`[${location}/${day}] Fetching event URLs from listing API`);
			const eventUrls = await withTimeout({
				label: `fetchEventUrlsFromPage ${location}/${day}`,
				timeoutMs: TIMEOUT_MS.listingFetch,
				task: async () => this.fetchEventUrlsFromPage(page, location)
			});
			if (!eventUrls.length) return [];
			console.log(`[${location}/${day}] Found ${eventUrls.length} event URLs`);

			const events: ScrapedEvent[] = [];
			for (const eventUrl of eventUrls) {
				const parsed = parseEventUrl(eventUrl);
				if (!parsed) {
					console.warn(`[${location}/${day}] Could not parse event URL: ${eventUrl}`);
					continue;
				}

				let didProcessEvent = false;
				for (let attempt = 1; attempt <= MAX_EVENT_RETRIES + 1; attempt++) {
					try {
						console.log(`[${location}/${day}] Processing ${eventUrl} attempt ${attempt}/${MAX_EVENT_RETRIES + 1}`);
						console.log(`[${location}/${day}] Fetching single event payload for ${eventUrl}`);
						const eventData = await withTimeout({
							label: `fetchSingleEventFromPage ${location}/${day} ${parsed.slug}`,
							timeoutMs: TIMEOUT_MS.singleEventFetch,
							task: async () => this.fetchSingleEventFromPage(page, parsed)
						});
						if (!eventData) {
							console.warn(`[${location}/${day}] No data returned for ${eventUrl}`);
							didProcessEvent = true;
							break;
						}

						console.log(`[${location}/${day}] Transforming payload into ScrapedEvent for ${eventUrl}`);
						const event = await withTimeout({
							label: `extractEventDataFromApi ${location}/${day} ${parsed.slug}`,
							timeoutMs: TIMEOUT_MS.eventTransform,
							task: async () => this.extractEventDataFromApi({
								data: eventData,
								url: eventUrl,
								location,
								page
							})
						});
						if (event) {
							events.push(event);
							console.log("extracted event", event);
						}
						didProcessEvent = true;
						break;
					} catch (error) {
						if (isTimeoutError(error)) this.runStats.timeoutErrors += 1;
						if (attempt <= MAX_EVENT_RETRIES) {
							this.runStats.retriedEvents += 1;
							console.warn(
								`[${location}/${day}] Attempt ${attempt}/${MAX_EVENT_RETRIES + 1} failed for ${eventUrl}. Retrying...`,
								error
							);
						} else {
							this.runStats.skippedAfterRetries += 1;
							console.warn(
								`[${location}/${day}] Skipping ${eventUrl} after ${MAX_EVENT_RETRIES + 1} failed attempts.`,
								error
							);
						}

						console.log(`[${location}/${day}] Closing current page for recovery`);
						await closeWithTimeout({ label: `${location}/${day} recovery page.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => page.close() });
						console.log(`[${location}/${day}] Closing current context for recovery`);
						await closeWithTimeout({ label: `${location}/${day} recovery context.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => context.close() });
						console.log(`[${location}/${day}] Closing current browser for recovery`);
						await closeWithTimeout({ label: `${location}/${day} recovery browser.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => browser.close() });

						if (attempt > MAX_EVENT_RETRIES) {
							break;
						}

						console.log(`[${location}/${day}] Relaunching fresh browser after recovery`);
						({ browser, context, page } = await withTimeout({
							label: `recovery launchFreshBrowser ${location}/${day}`,
							timeoutMs: TIMEOUT_MS.browserLaunch,
							task: async () => this.launchFreshBrowser({ location, day })
						}));
					}
				}

				if (!didProcessEvent) {
					console.warn(`[${location}/${day}] Event was not processed after retries: ${eventUrl}`);
					continue;
				}
			}

			return events;
		} finally {
			console.log(`[${location}/${day}] Closing page in finally`);
			await closeWithTimeout({ label: `${location}/${day} finally page.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => page.close() });
			console.log(`[${location}/${day}] Closing context in finally`);
			await closeWithTimeout({ label: `${location}/${day} finally context.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => context.close() });
			console.log(`[${location}/${day}] Closing browser in finally`);
			await closeWithTimeout({ label: `${location}/${day} finally browser.close`, timeoutMs: TIMEOUT_MS.closeResource, task: async () => browser.close() });
		}
	}

	/**
	 * Launches a completely fresh Playwright browser and navigates to the listing page.
	 * Uses stealth measures to bypass Cloudflare detection.
	 * Example: const { browser, page } = await scraper.launchFreshBrowser({ location: `ubud`, day: `today` })
	 */
	private async launchFreshBrowser(args: { location: string; day: string }): Promise<{
		browser: Awaited<ReturnType<typeof chromium.launch>>;
		context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>[`newContext`]>>;
		page: Page;
	}> {
		const { location, day } = args;
		console.log(`[${location}/${day}] chromium.launch with stealth args`);
		const browser = await chromium.launch({
			headless: true,
			args: [
				'--disable-blink-features=AutomationControlled',
				'--disable-features=IsolateOrigins,site-per-process',
				'--disable-site-isolation-trials',
				'--disable-dev-shm-usage',
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-gpu',
				'--disable-accelerated-2d-canvas',
				'--disable-background-networking',
				'--disable-background-timer-throttling',
				'--disable-breakpad',
				'--disable-client-side-phishing-detection',
				'--disable-default-apps',
				'--disable-extensions',
				'--disable-features=TranslateUI',
				'--disable-hang-monitor',
				'--disable-ipc-flooding-protection',
				'--disable-popup-blocking',
				'--disable-prompt-on-repost',
				'--disable-renderer-backgrounding',
				'--disable-sync',
				'--force-color-profile=srgb',
				'--metrics-recording-only',
				'--safebrowsing-disable-auto-update',
				'--password-store=basic',
				'--use-mock-keychain'
			]
		});
		console.log(`[${location}/${day}] browser.newContext`);
		const context = await browser.newContext({
			userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`,
			viewport: { width: 1920, height: 1080 },
			locale: 'en-US',
			timezoneId: 'America/New_York',
			permissions: ['geolocation'],
			geolocation: { latitude: 40.7128, longitude: -74.0060 }
		});

		// Remove webdriver property to avoid detection
		await context.addInitScript(() => {
			Object.defineProperty(navigator, 'webdriver', {
				get: () => undefined
			});
			Object.defineProperty(navigator, 'plugins', {
				get: () => [1, 2, 3, 4, 5]
			});
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en']
			});
			// @ts-expect-error - removing automation indicator
			delete window.chrome?.runtime?.OnInstalledReason;
			// @ts-expect-error - removing automation indicator
			delete window.chrome?.runtime?.OnRestartRequiredReason;
		});

		console.log(`[${location}/${day}] context.newPage`);
		const page = await context.newPage();

		// Add extra headers to appear more like a real browser
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'en-US,en;q=0.9',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Cache-Control': 'max-age=0',
			'Upgrade-Insecure-Requests': '1'
		});

		console.log(`[${location}/${day}] Opening page in fresh browser...`);
		console.log(`[${location}/${day}] page.goto listing URL`);

		// Add a random delay to seem more human-like
		await this.randomDelay(500, 1500);

		await page.goto(`https://todo.today/${location}/${day}/`, {
			waitUntil: `domcontentloaded`,
			timeout: 60000
		});

		// Wait a bit for any Cloudflare challenge to complete
		await this.randomDelay(2000, 4000);

		console.log(`[${location}/${day}] page.waitForSelector #tt-app`);
		await page.waitForSelector(`#tt-app`, { timeout: 60000 });
		return { browser, context, page };
	}

	/**
	 * Random delay to mimic human behavior
	 */
	private async randomDelay(min: number, max: number): Promise<void> {
		const delay = Math.floor(Math.random() * (max - min + 1)) + min;
		await new Promise(resolve => setTimeout(resolve, delay));
	}

	/**
	 * Calls the REST listing API from within a Playwright page context.
	 * Example: await scraper.fetchEventUrlsFromPage(page, `ubud`)
	 */
	private async fetchEventUrlsFromPage(page: Page, location: string): Promise<string[]> {
		console.log(`[${location}] Reading #tt-app config via page.evaluate`);
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

		console.log(`[${location}] Calling todo.today REST listing API via page.evaluate`);
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
		console.log(`[${params.location}] Calling tt_get_single_event for ${params.slug}`);
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
		const context = args.page.context();
		console.log(`Creating resolver page in existing browser context for ${sanitizedBookLink}`);
		console.log(`Creating resolver page for ${sanitizedBookLink}`);
		const resolverPage = await context.newPage();
		try {
			console.log(`Installing request filter on resolver page for ${sanitizedBookLink}`);
			await resolverPage.route(`**/*`, (route) => {
				const resourceType = route.request().resourceType();
				if (resourceType === `image` || resourceType === `media` || resourceType === `font` || resourceType === `stylesheet`) {
					void route.abort();
					return;
				}
				void route.continue();
			});
			console.log(`Navigating resolver page to ${sanitizedBookLink}`);
			await resolverPage.goto(sanitizedBookLink, {
				waitUntil: `commit`,
				timeout: 15000
			});

			// The first commit can still be the /go URL before client-side redirect settles.
			if (resolverPage.url().includes(`todo.today/go/`)) {
				console.log(`Waiting for redirect away from todo.today/go for ${sanitizedBookLink}`);
				try {
					await resolverPage.waitForURL((url) => !url.href.includes(`todo.today/go/`), { timeout: 10000 });
				} catch {
					console.warn(`Redirect did not leave todo.today/go in time for ${sanitizedBookLink}`);
				}
			}

			const resolvedUrl = resolverPage.url();
			console.log(`Resolved via browser: ${sanitizedBookLink} -> ${resolvedUrl}`);
			return resolvedUrl;
		} catch (error) {
			console.error(`Failed resolving book_link ${sanitizedBookLink}`, error);
			return sanitizedBookLink;
		} finally {
			console.log(`Closing resolver page for ${sanitizedBookLink}`);
			await closeWithTimeout({
				label: `resolver page.close ${sanitizedBookLink}`,
				timeoutMs: TIMEOUT_MS.closeResource,
				task: async () => resolverPage.close()
			});
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
		console.log(`Starting website scrape`);
		await scraper.scrapeWebsite();
		console.log(`Main execution finished, exiting with code 0`);
		process.exit(0);
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

	console.log(`Fetching login nonce page`);
	const resNonce = await customFetch('https://todo.today/my-account', { returnType: 'text' });
	const nonce = resNonce.match(/events_front_login\s*=\s*\{[^}]*"nonce":"([^"]+)"/)?.[1];
	console.log({ nonce });
	if (!nonce || nonce.length !== 10) {
		throw new Error('No valid nonce found for todo.today');
	}
	console.log(`Submitting ajax_login request`);
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
function buildIsoFromApiDate(args: { dateStr?: string; timeStr?: string; timeZone: TimeZoneString }): string | undefined {
	if (!args.dateStr) return undefined;

	const [year, month, day] = args.dateStr.split('-').map(Number);
	if (isNaN(year) || isNaN(month) || isNaN(day)) throw new Error('Invalid date string: ' + args.dateStr);

	const [hour, minute] = args.timeStr?.split(':').map(Number) ?? [];
	if (isNaN(hour) || isNaN(minute)) throw new Error('Invalid time string: ' + args.timeStr);

	return dateToIsoStr(year, month, day, hour, minute, args.timeZone, false);
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

function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.message.startsWith(`Timed out after`);
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
