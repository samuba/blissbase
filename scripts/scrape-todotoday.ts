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
import { ScrapedEvent } from "../src/lib/types.ts";
import {
    customFetch,
    WebsiteScraperInterface,
    cleanProseHtml,
    superTrim,
    baliDateToIsoStr,
    extractIcalStartAndEndTimes,
} from "./common.ts";
import * as cheerio from 'cheerio';
import { geocodeAddressCached } from "../src/lib/server/google.ts";

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];

        // today
        let html = await customFetch('https://todo.today/ubud/today/', { returnType: 'text' });
        let $ = cheerio.load(html);
        let eventUrls = new Set(
            $('.event_image').map((_index, element) => $(element).attr('href')).get().filter(Boolean)
        );
        for (const eventUrl of eventUrls) {
            const eventHtml = await customFetch(eventUrl, { returnType: 'text' });
            const event = await this.extractEventData(eventHtml, eventUrl);
            if (event) allEvents.push(event);
        }

        // tommorrow
        html = await customFetch('https://todo.today/', { 
            returnType: 'text', 
            // tomorrow only works logged in
            headers: { 'Cookie': 'wordpress_logged_in_81ee6838d0646bf88530eae937360076=samuelbach%7C1763964374%7CFpczQIecBc6AmxjrN0R7WZH4XlGHMNHR7pvItAjcGN9%7Cbf90fc0491e1cd13d43dac6fa8f56400e66308c40317c385fdf052d67de07b4f;'} 
        });
        $ = cheerio.load(html);
        eventUrls = new Set(
            $('.event_image').map((_index, element) => $(element).attr('href')).get().filter(Boolean)
        );
        for (const eventUrl of eventUrls) {
            const eventHtml = await customFetch(eventUrl, { returnType: 'text' });
            const event = await this.extractEventData(eventHtml, eventUrl);
            if (event) allEvents.push(event);
        }

        console.log({ allEvents });

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
        throw new Error("Method not implemented." + filePath);
    }
    async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        const $ = await cheerio.load(html);
        const name = superTrim($('h1').text())!;
        const description = cleanProseHtml($('.event_content_single_page').html());
        const imageUrls = $('.data-entry-content-single-page .event-image-container .lightbox-scope img').map((_index, element) => $(element).attr('src')).get().filter(Boolean);

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

        const address = superTrim($('.data-entry-content-single-page .event_curren_venue').text())!.split(',').map(part => part.trim());
        const price = superTrim($('.data-entry-content-single-page .event_ticket_price_single').text())!;
        const host = $('.data-entry-content-single-page .author-link').text()?.trim() || name.split(' w/ ')[1] ;
        const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');
        const sourceUrl = ($('.data-entry-content-single-page .ticket-link').attr('href')! ?? url).replace('TODOTODAY', '');
        const tags = $('.data-entry-content-single-page .event-category-label-no-image').map((_index, element) => $(element).text().trim()).get().filter(Boolean);

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
        throw new Error("Method not implemented." + html);
    }
    extractStartAt(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractEndAt(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractAddress(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractPrice(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractDescription(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractImageUrls(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractHost(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractHostLink(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractTags(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
}

// Execute the main function only when run directly
if (import.meta.main) {
    try {
        const scraper = new WebsiteScraper();
        console.log(await scraper.scrapeWebsite())
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}

export type LumayaEvent = {
    id: string
    slug: string
    imageUrls: Array<string>
    imageUrl: string
    title: string
    description: string
    capacity: number
    price: {
        currency?: string
        amount?: number
    }
    promotion: {
        affiliateUrl?: string
        booster?: string
    }
    location: {
        isTba: boolean
        areaId: string
        address: string
        placesId?: string
        latitude?: number
        longitude?: number
    }
    contact: {
        telegram?: string
        whatsapp?: string
        email?: string
        url?: string
        instagramUsername?: string
    }
    categories: Array<string>
    appointments: Array<{
        startDate: string
        endDate: string
    }>
    state: string
    consent: {
        allowPostOnInstagram: boolean
    }
    seoTitle?: string
    seoDescription?: string
    hasSeoInformation: boolean
    creationDate: string
    recurrenceRuleOptions?: string
}