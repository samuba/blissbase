/**
 * Fetches event pages from awara.events (starting from https://awara.events/veranstaltungen)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from awara.events:
 * - Iterates through all pagination pages
 * - Extracts all events as JSON according to the ScrapedEvent interface
 * - Fetches detailed information from each event's page
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file
 * - Extracts event data as JSON according to the ScrapedEvent interface
 * - Prints the single event JSON to standard output
 * 
 * Requires Bun (https://bun.sh/).
 * 
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-awara.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-awara.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';
import {
    WebsiteScraper,
    superTrim,
    parseGermanDate,
    fetchWithTimeout,
    REQUEST_DELAY_MS
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.ts';
export class AwaraScraper implements WebsiteScraper {

    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        console.error("--- Starting Awara Event Scraper ---");

        const allEvents: ScrapedEvent[] = [];
        let eventUrls: string[] = [];
        let currentPage = 1;
        let maxPages = 1; // Start with 1, will be updated after first fetch

        while (currentPage <= maxPages) {
            console.error(`--- Fetching page 1 to determine total pages ---`);
            await Bun.sleep(REQUEST_DELAY_MS); // Delay before first fetch
            const pageData = await fetchListingPageData(currentPage);

            if (!pageData || !pageData.html) {
                console.error("Failed to fetch initial page data. Stopping.");
                return []; // Exit if first page fails
            }

            if (pageData.max_num_pages) {
                const maxPagesStr = String(pageData.max_num_pages);
                maxPages = parseInt(maxPagesStr, 10);
                if (isNaN(maxPages) || maxPages <= 0) {
                    console.error(`Invalid max_num_pages received: ${maxPagesStr}. Assuming 1 page.`);
                    maxPages = 1;
                } else {
                    console.error(`Total pages determined: ${maxPages}`);
                }
            } else {
                console.error("Could not determine total number of pages from initial response. Assuming 1 page.");
                maxPages = 1;
            }


            const htmlContent = pageData.html ? String(pageData.html) : '';
            eventUrls = [...eventUrls, ...await extractEventUrls(htmlContent)];

            currentPage++;
        }

        console.error(`Found ${eventUrls.length} events on ${currentPage} pages`);


        // Process the first page's data before starting the loop for subsequent pages
        try {


            if (eventUrls.length === 0 && maxPages <= 1) {
                console.error("No events found on the first page and no other pages indicated. Exiting.");
                return []; // Output empty array
            }

            console.error(`Processing ${eventUrls.length} events from page ${currentPage}...`);
            for (const eventUrl of eventUrls) {
                try {
                    const html = await fetchWithTimeout(eventUrl);
                    if (!html) continue;
                    const event = await this.extractEventData(html, eventUrl);
                    if (!event) continue;
                    console.error(event);
                    allEvents.push(event);
                } catch (error) {
                    console.error(`Error processing event "${eventUrl}" from page ${currentPage}:`, error);
                }
            }
            currentPage++;

        } catch (error) {
            console.error(`Error processing initial list page data (page 1):`, error);
        }

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);

        return allEvents;
    }

    async scrapeHtmlFiles(filePath: string[]) {
        console.error("scraping html files", filePath)

        const events: ScrapedEvent[] = [];
        for (const file of filePath) {
            const html = await Bun.file(file).text();
            const event = await this.extractEventData(html, file)
            if (!event) continue;
            events.push(event);
        }
        return events;
    }

    async extractEventData(html: string, url: string) {
        const address = this.extractAddress(html);
        const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');
        const startAt = this.extractStartAt(html);
        if (!startAt) return undefined;

        return {
            description: this.extractDescription(html),
            address: address,
            latitude: coordinates?.lat,
            longitude: coordinates?.lng,
            name: this.extractName(html),
            host: this.extractHost(html),
            startAt: startAt,
            endAt: this.extractEndAt(html),
            price: this.extractPrice(html),
            priceIsHtml: false,
            imageUrls: this.extractImageUrls(html),
            hostLink: this.extractHostLink(html),
            tags: this.extractTags(html),
            sourceUrl: url,
            source: 'awara',
        };
    }
    extractName(html: string) {
        const $ = cheerio.load(html);
        const name = superTrim($('.entry-title').text());
        if (!name) throw new Error("Name not found");
        return name;
    }
    extractStartAt(html: string) {
        const $ = cheerio.load(html);
        const startAt = parseGermanDate(superTrim($('.wpem-event-date-time-text').first().text()));
        if (!startAt) throw new Error("Start time not found");
        return startAt;
    }
    extractEndAt(html: string) {
        const $ = cheerio.load(html);
        const endAt = superTrim($('.wpem-event-date-time-text').last().text());
        if (!endAt) return undefined;
        return parseGermanDate(endAt);
    }
    extractAddress(html: string): string[] {
        const $ = cheerio.load(html);
        const addressContainer = $('.wpem-heading-text:contains("Adresse")').next('div');
        if (addressContainer.length === 0) return []

        // Get the text content and split by line breaks
        const addressText = addressContainer.html() || '';
        // Replace <br> tags with newlines, then split by newlines
        const addressLines = addressText
            .replace(/<br\s*\/?>/gi, '\n')
            .split('\n')
            .map(line => superTrim(line) || '')
            .filter(line => line.length > 0);

        return addressLines;
    }
    extractPrice(html: string) {
        const $ = cheerio.load(html);
        const priceContainer = $('.wpem-heading-text:contains("Preis")').next('div');
        if (priceContainer.length === 0) return undefined;

        return priceContainer.text().trim();
    }
    extractDescription(html: string) {
        const $ = cheerio.load(html);
        const eventBody = $('.wpem-single-event-body-content')
        eventBody.find('.wpem-single-event-ticket-information').remove();
        return eventBody.html()?.trim();
    }
    extractImageUrls(html: string) {
        const $ = cheerio.load(html);
        const imageUrls: string[] = $('.wpem-event-single-image img').map((index, element) => $(element).attr('src')).get();
        if (!imageUrls) return [];
        return imageUrls;
    }
    extractHost(html: string) {
        const $ = cheerio.load(html);
        return superTrim($('.wpem-event-organizer-name a').text());
    }
    extractHostLink(html: string) {
        const $ = cheerio.load(html);
        return superTrim($('.wpem-event-organizer-name a').attr('href'));
    }
    extractTags(html: string) {
        return [];
    }
}


async function fetchListingPageData(page: number): Promise<Record<string, unknown> | null> {
    const BASE_URL = "https://www.awara.events";
    const START_PATH = "/veranstaltungen/";
    const LISTINGS_URL = `${BASE_URL}/em-ajax/get_listings/`;
    const formData = new URLSearchParams();
    formData.append('lang', '');
    formData.append('search_keywords', '');
    formData.append('search_location', '');
    formData.append('search_datetimes[]', ''); // Must use [] for array parameters
    formData.append('per_page', '24'); // Or adjust as needed
    formData.append('orderby', 'event_start_date');
    formData.append('order', 'ASC');
    formData.append('page', String(page));
    formData.append('event_online', '');
    formData.append('show_pagination', 'true');
    // Simplified form_data, check if more fields are strictly required by the server
    formData.append('form_data', 'search_keywords=&search_location=&search_within_radius%5B%5D=10&search_distance_units%5B%5D=km&google_map_lat=&google_map_lng=&search_datetimes%5B%5D=&search_orderby%5B%5D=');

    return fetchWithTimeout(LISTINGS_URL, {
        method: 'POST',
        headers: {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': `${BASE_URL}${START_PATH}`, // Important for some checks
            'X-Requested-With': 'XMLHttpRequest', // Important for AJAX detection
            'Origin': BASE_URL, // Important for CORS
        },
        body: formData.toString()
    }).then(responseText => {
        if (!responseText) return null;
        try {
            return JSON.parse(responseText) as Record<string, unknown>;
        } catch (error) {
            console.error(`Error parsing JSON from listings response:`, error);
            return null;
        }
    });
}

/**
 * Extracts event urls from the HTML snippet provided by the AJAX response.
 */
async function extractEventUrls(html: string): Promise<string[]> {
    const $ = cheerio.load(html);
    const urls: string[] = [];
    // The AJAX response HTML seems to already contain the event listings directly
    // Adjust selector if the structure within response.html differs significantly
    const eventsOnPage = $('.event_listing');

    console.error(`Found ${eventsOnPage.length} events in HTML snippet.`);

    eventsOnPage.each((_index: number, element: cheerio.Element) => {
        const $element = $(element);
        const permalinkElement = $element.find('a.wpem-event-action-url').first();
        const permaLink = permalinkElement.attr('href');
        if (!permaLink) return;
        urls.push(permaLink);
    })
    return urls;
}


// Execute the main function only when run directly
if (import.meta.main) {
    try {
        const scraper = new AwaraScraper()
        if (process.argv.length > 2) {
            console.log(await scraper.scrapeHtmlFiles(process.argv.slice(2)))
        } else {
            console.log(await scraper.scrapeWebsite())
        }
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}