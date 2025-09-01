/**
 * Fetches event pages from kuschelraum.de (starting from https://kuschelraum.de/events)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from kuschelraum.de:
 * - Iterates through all pagination pages.
 * - Fetches each event's detail page.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prioritizes data from LD+JSON script tags if available.
 * - Handles recurring events by creating unique URLs for each occurrence.
 * - Uses proper German timezone (Europe/Berlin) for datetime handling.
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prints the single event JSON to standard output.
 *
 * Requires Bun (https://bun.sh/).
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-kuschelraum.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-kuschelraum.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';
import {
    WebsiteScraperInterface,
    REQUEST_DELAY_MS,
    cleanProseHtml,
    germanDateToIsoStr
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

interface MECEventResponse {
    html: string;
    end_date: string;
    offset: number;
    count: number;
    current_month_divider: string;
    has_more_event: number;
}

interface LDJsonEvent {
    '@type': string;
    name: string;
    startDate: string;
    endDate: string;
    location: {
        '@type': string;
        name: string;
        address?: string;
    };
    organizer: {
        '@type': string;
        name: string;
        url: string;
    };
    offers: {
        url: string;
        price: string;
        priceCurrency: string;
    };
    description: string;
    image: string;
    url: string;
}

/**
 * Fetches events from the Modern Events Calendar plugin for a specific date range
 * @param startDate Start date in YYYY-MM-DD format
 * @param offset Pagination offset
 * @returns Promise with event data
 */
async function fetchEventsFromMEC(startDate: string, offset: number = 1): Promise<MECEventResponse> {
    const res = await fetch('https://kuschelraum.de/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            'cache-control': 'no-cache',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'dnt': '1',
            'origin': 'https://kuschelraum.de',
            'pragma': 'no-cache',
            'referer': 'https://kuschelraum.de/events/',
            'cookie': 'cookielawinfo-checkbox-necessary=yes; cookielawinfo-checkbox-functional=yes; cookielawinfo-checkbox-performance=yes; cookielawinfo-checkbox-analytics=yes; cookielawinfo-checkbox-advertisement=yes; cookielawinfo-checkbox-others=yes; CookieLawInfoConsent=eyJuZWNlc3NhcnkiOnRydWUsImZ1bmN0aW9uYWwiOnRydWUsInBlcmZvcm1hbmNlIjp0cnVlLCJhbmFseXRpY3MiOnRydWUsImFkdmVydGlzZW1lbnQiOnRydWUsIm90aGVycyI6dHJ1ZX0=; viewed_cookie_policy=yes'
        },
        body: new URLSearchParams({
            'action': 'mec_list_load_more',
            'mec_start_date': startDate,
            'mec_offset': offset.toString(),
            'atts[sk-options][monthly_view][style]': 'classic',
            'atts[sk-options][timetable][style]': 'modern',
            'atts[sk-options][list][style]': 'standard',
            'atts[sk-options][list][start_date_type]': '',
            'atts[sk-options][list][start_date]': '',
            'atts[sk-options][list][sed_method]': '0',
            'atts[sk-options][list][image_popup]': '0',
            'atts[sk-options][list][display_price]': '0',
            'atts[sk-options][list][limit]': '12',
            'atts[sk-options][grid][style]': 'classic',
            'atts[id]': '675',
            'atts[sf_status]': '0',
            'current_month_divider': startDate.replace('-', '').substring(0, 6),
            'apply_sf_date': '0'
        })
    });
    return res.json();
}

/**
 * Fetches the detail page for a specific event
 * @param eventUrl The URL of the event detail page
 * @returns Promise with HTML content
 */
async function fetchEventDetailPage(eventUrl: string): Promise<string> {
    const res = await fetch(eventUrl, {
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            'cache-control': 'no-cache',
            'dnt': '1',
            'pragma': 'no-cache',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    return res.text();
}

/**
 * Extracts LD+JSON event data from HTML
 * @param html HTML content
 * @returns Single parsed LD+JSON event object 
 */
function extractLDJsonEvent(html: string): LDJsonEvent {
    const $ = cheerio.load(html);

    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const jsonText = $(element).html();
            if (jsonText) {
                const parsed = JSON.parse(jsonText);
                if (parsed['@type'] === 'Event') {
                    return parsed as LDJsonEvent;
                }
            }
        } catch (error) {
            console.error('Error parsing LD+JSON:', error);
            throw error;
        }
    }

    throw new Error('No LD+JSON event found');
}

/**
 * Extracts event URLs from the listing HTML
 * @param html HTML content from the listing page
 * @returns Array of event URLs
 */
function extractEventUrls(html: string): string[] {
    const $ = cheerio.load(html);
    const urls: string[] = [];

    // Look for event links in the listing
    $('a[href*="/events/"]').each((_, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('/events/') && !href.includes('#')) {
            urls.push(href);
        }
    });

    return [...new Set(urls)]; // Remove duplicates
}

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        console.error('Starting to scrape kuschelraum.de for events...');
        const allEvents: ScrapedEvent[] = [];
        const processedUrls = new Set<string>();
        const offset = 0;
        let hasMore = true;
        const maxPages = 10; // Prevent infinite loops
        const seenUrlsForDate = new Set<string>(); // Track URLs for this date
        let date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        while (hasMore && offset <= maxPages) {
            try {
                const response = await fetchEventsFromMEC(date, offset);
                hasMore = response.has_more_event === 1
                date = response.end_date

                if (!response.html || response.html.trim() === '') {
                    console.error(`No events found for ${date}`);
                    break;
                }

                // Extract event URLs from the listing
                const eventUrls = extractEventUrls(response.html);

                // If no event URLs found, break the pagination loop
                if (eventUrls.length === 0) {
                    console.error(`No event URLs found for date ${date}, offset ${offset}`);
                    break;
                }

                // Check if we're getting duplicate URLs (indicating no more new events)
                const newUrls = eventUrls.filter(url => !seenUrlsForDate.has(url));
                if (newUrls.length === 0) {
                    console.error(`No new URLs found for date ${date}, offset ${offset} - breaking pagination`);
                    break;
                }

                // Add all URLs to the seen set
                eventUrls.forEach(url => seenUrlsForDate.add(url));

                for (const eventUrl of eventUrls) {
                    // Skip if we've already processed this URL
                    if (processedUrls.has(eventUrl)) {
                        continue;
                    }

                    try {
                        console.error(`Fetching detail page: ${eventUrl}`);

                        // Fetch the event detail page
                        const detailHtml = await fetchEventDetailPage(eventUrl);

                        // Extract event data using the extractEventData method
                        const scrapedEvent = await this.extractEventData(detailHtml, eventUrl);

                        if (scrapedEvent) {
                            console.log(scrapedEvent);
                            allEvents.push(scrapedEvent);
                            processedUrls.add(eventUrl);

                            console.error(`✓ Processed: ${scrapedEvent.name} (${scrapedEvent.startAt})`);
                        } else {
                            console.error(`No event data found for: ${eventUrl}`);
                        }

                        // Add delay between detail page requests
                        await Bun.sleep(REQUEST_DELAY_MS);

                    } catch (error) {
                        console.error(`Error processing event ${eventUrl}:`, error);
                    }
                }

                console.error(`Processed ${eventUrls.length} events for date ${date}, offset ${offset}`);

                // Break if we've reached the maximum pages
                if (offset > maxPages) {
                    console.error(`Reached maximum pages (${maxPages}) for date ${date}`);
                    break;
                }

                // Add delay between requests
                await Bun.sleep(REQUEST_DELAY_MS);

            } catch (error) {
                console.error(`Error fetching events for ${date} with offset ${offset}:`, error);
                break;
            }
        }

        console.error(`Scraping completed. Found ${allEvents.length} unique events.`);
        return allEvents;
    }

    async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
        console.error(`Processing ${filePaths.length} HTML files...`);
        const allEvents: ScrapedEvent[] = [];

        for (const filePath of filePaths) {
            console.error(`Processing HTML file: ${filePath}...`);
            try {
                const htmlContent = await Bun.file(filePath).text();
                const event = await this.extractEventData(htmlContent, filePath);
                if (event) {
                    allEvents.push(event);
                }
            } catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
            }
        }

        return allEvents;
    }

    async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        const event = {
            name: this.extractName(html),
            startAt: this.extractStartAt(html),
            endAt: this.extractEndAt(html),
            address: this.extractAddress(html),
            price: this.extractPrice(html),
            priceIsHtml: false,
            description: this.extractDescription(html),
            imageUrls: this.extractImageUrls(html),
            host: this.extractHost(html),
            hostLink: this.extractHostLink(html),
            latitude: null as number | null,
            longitude: null as number | null,
            sourceUrl: url,
            source: 'kuschelraum',
            tags: this.extractTags()
        };

        if (!event.name || !event.startAt || !event.endAt) {
            console.error(`Missing required fields for event at ${url}`);
            return undefined;
        }

        if (event.address?.length) {
            const coords = await geocodeAddressCached(event.address, getGoogleMapsApiKey());
            if (coords) {
                event.latitude = coords.lat;
                event.longitude = coords.lng;
            }
        }

        return event;
    }

    extractName(html: string) {
        const $ = cheerio.load(html);
        return $('.mec-single-title').text().trim();
    }

    extractStartAt(html: string) {
        const $ = cheerio.load(html);
        const timeText = $('.mec-single-event-time abbr').text(); // 16:00 - 18:00
        const [startTime] = timeText.split("-").map(time => time.trim());
        const [hours, minutes] = startTime.split(':').map(Number);

        const ldEvent = extractLDJsonEvent(html);
        const startDate = new Date(ldEvent.startDate);
        return germanDateToIsoStr(
            startDate.getFullYear(),
            startDate.getMonth(),
            startDate.getDate(),
            hours,
            minutes
        );
    }

    extractEndAt(html: string) {
        const $ = cheerio.load(html);
        const timeText = $('.mec-single-event-time abbr').text(); // 16:00 - 18:00
        const [, endTime] = timeText.split("-").map(time => time.trim());
        const [hours, minutes] = endTime.split(':').map(Number);

        const ldEvent = extractLDJsonEvent(html);
        const endDate = new Date(ldEvent.endDate);
        return germanDateToIsoStr(
            endDate.getFullYear(),
            endDate.getMonth(),
            endDate.getDate(),
            hours,
            minutes
        );
    }

    extractAddress(html: string): string[] {
        const $ = cheerio.load(html);
        let addressText = $('strong').filter((_, el) => $(el).text().trim() === 'ORT').first().parent().text().replace('ORT', '').trim();
        if (!addressText) {
            addressText = $('strong').filter((_, el) => $(el).text().trim() === 'PLACE').first().parent().text().replace('PLACE', '').trim();
        }
        if (!addressText) return [];

        // add city if its not in the address text
        const city = $('.mec-location').text().split('|')[0]?.trim();
        if (!addressText.toUpperCase().includes(city?.toUpperCase() ?? '')) {
            addressText = `${city}, ${addressText}`;
        }

        return addressText.split(',').flatMap(part => part.split('\n')).map(part => part.trim()).filter(part => part.length > 0);
    }

    extractPrice(_html: string): string | undefined {
        return undefined;
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html);
        const description = $('.mec-single-event-description .fusion-text').html();
        return description ? cleanProseHtml(description) : undefined;
    }

    extractImageUrls(html: string): string[] {
        const $ = cheerio.load(html);
        const url = $('.mec-events-event-image img').first().attr('src');
        if (!url) return [];
        return [url];
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html);
        return $('.mec-organizer h6').text().trim() || undefined;
    }

    extractHostLink(html: string): string | undefined {
        // Try to get host link from LD+JSON first
        const ldEvent = extractLDJsonEvent(html);
        if (ldEvent?.organizer?.url) {
            return ldEvent.organizer.url;
        }

        // Fallback to HTML extraction if needed
        const $ = cheerio.load(html);
        const hostLink = $('.mec-organizer-url a').attr('href');
        return hostLink || undefined;
    }

    extractTags(): string[] {
        return [];
    }
}

// Helper to get Google Maps API key safely
function getGoogleMapsApiKey(): string {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY environment variable is not set');
    return key;
}

// Execute the main function only when run directly
if (import.meta.main) {
    try {
        const scraper = new WebsiteScraper();
        if (process.argv.length > 2) {
            console.log(await scraper.scrapeHtmlFiles(process.argv.slice(2)))
        } else {
            console.log(await scraper.scrapeWebsite())
        }
        process.exit(0);
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}
