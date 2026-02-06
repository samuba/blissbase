/**
 * Fetches event pages from heilnetz.de (starting from https://heilnetz.de/aktuelle-termine.html)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from heilnetz.de:
 * - Iterates through all pagination pages.
 * - Fetches each event's detail page.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prioritizes data from LD+JSON script tags if available.
 * - Handles recurring events by extracting each occurrence with its specific date.
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prints the single event JSON to standard output.
 *
 * Requires Bun (https://bun.sh/).
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-heilnetz.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-heilnetz.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from '../src/lib/types.ts';
import {
	customFetch,
	WebsiteScraperInterface,
	cleanProseHtml,
	superTrim,
	baliDateToIsoStr,
	extractIcalStartAndEndTimes
} from './common.ts';
import * as cheerio from 'cheerio';
import { geocodeAddressCached } from '../src/lib/server/google.ts';

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];

		// today
		let html = await customFetch('https://todo.today/ubud/today/', { returnType: 'text' });
		let $ = cheerio.load(html);
		$('[aria-labelledby="section-heading-early_tomorrow"]').remove(); // we process events for tomorrow separately
		let eventUrls = new Set(
			$('.event_image')
				.map((_index, element) => $(element).attr('href'))
				.get()
				.filter(Boolean)
		);
		for (const eventUrl of eventUrls) {
			const eventHtml = await customFetch(eventUrl, { returnType: 'text' });
			const event = await this.extractEventData(eventHtml, eventUrl);
			if (event) allEvents.push(event);
		}

		// tommorrow
        const authCookie = await login();
		html = await customFetch('https://todo.today/ubud/tomorrow/', {
			returnType: 'text',
			headers: { Cookie: authCookie } // tomorrow only works logged in
		});
		$ = cheerio.load(html);
		eventUrls = new Set(
			$('.event_image')
				.map((_index, element) => $(element).attr('href'))
				.get()
				.filter(Boolean)
		);
		const eventCountBeforeTomorrow = allEvents.length + 0;
		for (const eventUrl of eventUrls) {
			const eventHtml = await customFetch(eventUrl, { returnType: 'text', headers: { Cookie: authCookie } });
			const event = await this.extractEventData(eventHtml, eventUrl);
			if (event) allEvents.push(event);
		}
		if (eventCountBeforeTomorrow === allEvents.length) {
			throw new Error('No new events found for tomorrow! Something went wrong with the login.')
		}

		console.log({ allEvents });

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error('Method not implemented.' + filePath);
	}
	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		const $ = await cheerio.load(html);
		const name = superTrim($('h1').text())!;
		const imageUrls = $(
			'.data-entry-content-single-page .event-image-container .lightbox-scope img'
		)
			.map((_index, element) => $(element).attr('src'))
			.get()
			.filter(Boolean);

		// move hidden elements to the end of description
		const descriptionElement = $('.event_content_single_page');
		const hiddenElements = descriptionElement.find('.tt-hidden').remove();
		//descriptionElement.append(hiddenElements);
		const description = cleanProseHtml(descriptionElement.html());

		const icalTimes = extractIcalStartAndEndTimes(html);
		const startAt = baliDateToIsoStr(
			parseInt(icalTimes.startAt!.slice(0, 4)),
			parseInt(icalTimes.startAt!.slice(4, 6)),
			parseInt(icalTimes.startAt!.slice(6, 8)),
			parseInt(icalTimes.startAt!.slice(9, 11)),
			parseInt(icalTimes.startAt!.slice(11, 13))
		);
		const endAt = baliDateToIsoStr(
			parseInt(icalTimes.endAt!.slice(0, 4)),
			parseInt(icalTimes.endAt!.slice(4, 6)),
			parseInt(icalTimes.endAt!.slice(6, 8)),
			parseInt(icalTimes.endAt!.slice(9, 11)),
			parseInt(icalTimes.endAt!.slice(11, 13))
		);
		// Fallback to parsing from URL and time text
		// const urlParts = url.split("/").reverse();
		// const time = superTrim($('.event_single_page_time').text()!.split('·')[1])!
		// const [startTime, endTime] = time.split(" - ");
		// startAt = baliDateToIsoStr(parseInt(urlParts[3]), parseInt(urlParts[2]), parseInt(urlParts[1]), parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1]));
		// endAt = baliDateToIsoStr(parseInt(urlParts[3]), parseInt(urlParts[2]), parseInt(urlParts[1]), parseInt(endTime.split(':')[0]), parseInt(endTime.split(':')[1]));

		const address = superTrim($('.data-entry-content-single-page .event_curren_venue').text())!
			.split(',')
			.map((part) => part.trim());
		const price = superTrim(
			$('.data-entry-content-single-page .event_ticket_price_single').text()
		)!;
		let host: string | undefined =
			$('.data-entry-content-single-page .author-link')
				.filter((_i, el) => !$(el).parent().hasClass('tt-hidden'))
				.text()?.trim() || name.split(' w/ ')[1];
        host = host.toLowerCase() === 'todo.today' ? undefined : host;
		const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');
		const sourceUrl = (
			$('.data-entry-content-single-page .ticket-link').attr('href')! ?? url
		).replace('TODOTODAY', '');
		const tags = $('.tt-single-page-tags-container .tt-tag-box')
			.map((_index, element) => {
				const $el = $(element);
                // dont include hidden tags, they use it to put todo.today in our tags
				if ($el.hasClass('tt-hidden')) return null;
				// Remove special characters that are not normal text like emojis
				return $el.text().replace(/[^\w\s\-&]/g, '').trim();
			})
			.get()
			.filter(Boolean);

		const event = {
			name,
			description,
			imageUrls,
			startAt,
			endAt,
			address,
			price,
			priceIsHtml: false,
			host,
			hostLink: undefined,
			contact: [],
			latitude: coordinates?.lat,
			longitude: coordinates?.lng,
			tags,
			sourceUrl,
			source: 'todotoday' as const
		} satisfies ScrapedEvent;
		console.log({ event });
		return event;
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
		console.log(await scraper.scrapeWebsite());
	} catch (error) {
		console.error('Unhandled error in main execution:', error);
		process.exit(1);
	}
}

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
		throw new Error('No validnonce found for todo.today');
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
