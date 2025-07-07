/**
 * Fetches event pages from www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/index.php
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from the website:
 * - Iterates through pagination pages if available.
 * - Fetches each event's detail page after parsing from list pages.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file (expected to be an event detail page).
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prints the single event JSON to standard output.
 *
 * Requires Bun (https://bun.sh/) for running, primarily for 'Bun.file' in local mode.
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-ggbrandenburg.ts > ggbrandenburg-events.json
 *   To parse a local file:  bun run scripts/scrape-ggbrandenburg.ts <path_to_html_file> > ggbrandenburg-event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';
import {
    REQUEST_DELAY_MS,
    WebsiteScraper,
    cleanProseHtml,
    customFetch,
    germanDateToIsoStr
} from "./common.ts";
import { sleep } from "bun";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const BASE_URL = "https://www.ganzheitlich-gesund-brandenburg.de";
const START_PATH = "/veranstaltungen/index.php";

export class GGBrandenburgScraper implements WebsiteScraper {
    private readonly baseUrl: string;
    private readonly startPath: string;
    private readonly requestDelayMs: number;

    constructor() {
        this.baseUrl = BASE_URL;
        this.startPath = START_PATH;
        this.requestDelayMs = REQUEST_DELAY_MS;
    }

    private async extractEventUrls(html: string): Promise<string[]> {
        const $ = cheerio.load(html);
        const permalinks: string[] = [];
        const eventCards = $('div.row.events-entry-3');

        eventCards.each((_index, element) => {
            const $card = $(element);
            const $link = $card.find('a[href*="/veranstaltungen/"]').first();
            const permalink = $link.attr('href');

            if (permalink && permalink.includes('/veranstaltungen/')) {
                // Make sure we have a full URL
                const fullUrl = permalink.startsWith('http') ? permalink : this.baseUrl + permalink;
                permalinks.push(fullUrl);
            }
        });

        return permalinks;
    }

    // ---- WebsiteScraper Interface Methods for Extracting Fields from Detail Page HTML ----

    extractName(html: string): string | undefined {
        return this.getJsonLdData(html).name;
    }

    getJsonLdData(html: string) {
        const $ = cheerio.load(html);
        const jsonLdData = $('script[type="application/ld+json"]').eq(1).html();
        return JSON.parse(jsonLdData || '{}') as {
            name: string,
            description: string,
            startDate: string,
            endDate: string | undefined,
            location: { name: string },
            image: string[]
        };
    }

    extractStartAt(html: string): string | undefined {
        const $ = cheerio.load(html);

        // Look for the date/time in the h5 element
        let dateTimeElement = $('h5').first().text();
        // Clean up invisible characters like zero-width space
        dateTimeElement = dateTimeElement.replace(/[\u200B-\u200D\uFEFF]/g, '');
        // Parse multi-day patterns first: "05.09.2025 bis 07.09.2025 von 17:00 – 00:00 Uhr"
        const multiDayMatch = dateTimeElement.match(/(\d{2})\.(\d{2})\.(\d{4})\s+bis\s+\d{2}\.\d{2}\.\d{4}\s+von\s+(\d{1,2}):(\d{2})/);
        if (multiDayMatch) {
            const day = parseInt(multiDayMatch[1]);
            const month = parseInt(multiDayMatch[2]) - 1;
            const year = parseInt(multiDayMatch[3]);
            const hour = parseInt(multiDayMatch[4]);
            const minute = parseInt(multiDayMatch[5]);

            return germanDateToIsoStr(year, month, day, hour, minute);
        }

        // Parse single-day patterns (only if no "bis" is found): "08.07.2025 von 18:30 – 20:30 Uhr"
        if (!dateTimeElement.includes('bis')) {
            const singleDayMatch = dateTimeElement.match(/(\d{2})\.(\d{2})\.(\d{4})\s+von\s+(\d{1,2}):(\d{2})/);
            if (singleDayMatch) {
                const day = parseInt(singleDayMatch[1]);
                const month = parseInt(singleDayMatch[2]) - 1; // JavaScript months are 0-indexed
                const year = parseInt(singleDayMatch[3]);
                const hour = parseInt(singleDayMatch[4]);
                const minute = parseInt(singleDayMatch[5]);

                return germanDateToIsoStr(year, month, day, hour, minute);
            }
        }

        // Alternative: look for time elements and extract from surrounding h5
        const timeElements = $('time');
        if (timeElements.length > 0) {
            const firstTime = timeElements.first().text();
            let h5Text = timeElements.first().closest('h5').text();
            // Clean up invisible characters
            h5Text = h5Text.replace(/[\u200B-\u200D\uFEFF]/g, '');

            // For multi-day events, get the first date
            const dateMatch = h5Text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            const timeMatch = firstTime.match(/(\d{1,2}):(\d{2})/);

            if (dateMatch && timeMatch) {
                const day = parseInt(dateMatch[1]);
                const month = parseInt(dateMatch[2]) - 1;
                const year = parseInt(dateMatch[3]);
                const hour = parseInt(timeMatch[1]);
                const minute = parseInt(timeMatch[2]);

                return germanDateToIsoStr(year, month, day, hour, minute);
            }
        }

        return undefined;
    }

    extractEndAt(html: string): string | undefined {
        const $ = cheerio.load(html);

        // Look for the end time in the h5 element
        let dateTimeElement = $('h5').first().text();
        // Clean up invisible characters like zero-width space
        dateTimeElement = dateTimeElement.replace(/[\u200B-\u200D\uFEFF]/g, '');

        // Parse single-day patterns like "08.07.2025 von 18:30 – 20:30 Uhr"
        const singleDayMatch = dateTimeElement.match(/(\d{2})\.(\d{2})\.(\d{4})\s+von\s+\d{1,2}:\d{2}\s*[–-]\s*(\d{1,2}):(\d{2})/);
        if (singleDayMatch) {
            const day = parseInt(singleDayMatch[1]);
            const month = parseInt(singleDayMatch[2]) - 1; // JavaScript months are 0-indexed
            const year = parseInt(singleDayMatch[3]);
            const endHour = parseInt(singleDayMatch[4]);
            const endMinute = parseInt(singleDayMatch[5]);

            return germanDateToIsoStr(year, month, day, endHour, endMinute);
        }

        // Check for multi-day events like "05.09.2025 bis 07.09.2025 von 17:00 – 00:00 Uhr"
        const multiDayMatch = dateTimeElement.match(/\d{2}\.\d{2}\.\d{4}\s+bis\s+(\d{2})\.(\d{2})\.(\d{4})/);
        if (multiDayMatch) {
            const endDay = parseInt(multiDayMatch[1]);
            const endMonth = parseInt(multiDayMatch[2]) - 1;
            const endYear = parseInt(multiDayMatch[3]);

            // Look for end time information in the description
            const bodyText = $('body').text();
            const endTimeMatch = bodyText.match(/endet\s+am\s+\w+\s+um\s+(\d{1,2})\.(\d{2})\s+uhr/i);
            if (endTimeMatch) {
                const endHour = parseInt(endTimeMatch[1]);
                const endMinute = parseInt(endTimeMatch[2]);
                return germanDateToIsoStr(endYear, endMonth, endDay, endHour, endMinute);
            }

            // Default to end of day for multi-day events
            return germanDateToIsoStr(endYear, endMonth, endDay, 15, 0); // 15:00 as mentioned in description
        }

        // Alternative: look for second time element (for same-day events)
        const timeElements = $('time');
        if (timeElements.length > 1) {
            const secondTime = timeElements.eq(1).text();
            let h5Text = timeElements.first().closest('h5').text();
            // Clean up invisible characters
            h5Text = h5Text.replace(/[\u200B-\u200D\uFEFF]/g, '');

            // Extract date from h5 and end time from second time element
            const dateMatch = h5Text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            const timeMatch = secondTime.match(/(\d{1,2}):(\d{2})/);

            if (dateMatch && timeMatch && secondTime !== '00:00') {
                const day = parseInt(dateMatch[1]);
                const month = parseInt(dateMatch[2]) - 1;
                const year = parseInt(dateMatch[3]);
                const hour = parseInt(timeMatch[1]);
                const minute = parseInt(timeMatch[2]);

                return germanDateToIsoStr(year, month, day, hour, minute);
            }
        }

        return undefined;
    }

    extractAddress(html: string): string[] | undefined {
        return (this.getJsonLdData(html).location?.name ?? '').split(',').map(s => s.trim());
    }

    extractPrice(html: string): string | undefined {
        return undefined;
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html);

        let description = '';
        $('#mainBox #content p.tiny_p').each((i, el) => {
            const elementHtml = $(el).prop('outerHTML')?.trim() ?? '';
            if (elementHtml.length > 0) {
                description += elementHtml + ' ';
            }
        });
        description = this.resolveEmail(description);

        return cleanProseHtml(description);
    }

    resolveEmail(description: string) {
        // <script>emailtext('bc.richter', 'gmx', 'de');</script><object type=\"multipart/example\"><noscript>bc.richter(at)gmx.de</noscript></object>
        const emailRegex = /<script>emailtext\((.*)\);<\/script>/;
        const match = description.match(emailRegex);
        if (!match) return description;

        const [username, domain, tld] = match[1].replaceAll("'", '').replaceAll(' ', '').split(',');
        const email = `${username}@${domain}.${tld}`;
        return description.replace(/<script>emailtext\(.*<\/noscript><\/object>/, `<a href="mailto:${email}">${email}</a>`);
    }

    extractImageUrls(html: string): string[] | undefined {
        return this.getJsonLdData(html).image;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html);

        // Look for host/organizer in dedicated sections first
        const organizerHeading = $('h3:contains("Veranstalter")');
        if (organizerHeading.length > 0) {
            const organizerName = organizerHeading.next('h5').text().trim();
            if (organizerName) {
                return organizerName;
            }
        }

        // Look for seminar leadership in content
        const contentText = $('p.tiny_p').text();
        const leadershipMatch = contentText.match(/seminarleitung[:\s]*([^(]+)/gi);
        if (leadershipMatch && leadershipMatch[0]) {
            const leader = leadershipMatch[0].replace(/seminarleitung[:\s]*/gi, '').trim();
            if (leader && leader.length < 100) {
                return leader;
            }
        }

        // Look for other organizer patterns
        const hostPatterns = [
            /veranstalter[:\s]*([^.\n]{10,50})/gi,
            /organisator[:\s]*([^.\n]{10,50})/gi,
            /durchführung[:\s]*([^.\n]{10,50})/gi
        ];

        for (const pattern of hostPatterns) {
            const match = contentText.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return undefined;
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html);

        // Look for external links under "Weiterführende Links"
        const linksHeading = $('h3:contains("Weiterführende Links")');
        if (linksHeading.length > 0) {
            const nextLink = linksHeading.next('a');
            if (nextLink.length > 0) {
                return nextLink.attr('href');
            }
        }

        return undefined;
    }

    extractTags(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const tagsSet = new Set<string>();

        // Look for keywords in meta tags
        const keywordsElement = $('meta[name="keywords"]');
        if (keywordsElement.length > 0) {
            const keywords = keywordsElement.attr('content');
            if (keywords) {
                const keywordArray = keywords.split(',').map(k => k.trim());
                keywordArray.forEach(keyword => {
                    if (keyword.length > 0 && keyword.length < 50) {
                        tagsSet.add(keyword);
                    }
                });
            }
        }

        return tagsSet.size > 0 ? Array.from(tagsSet) : undefined;
    }

    // ---- Main Scraper Logic ----

    public async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        const name = this.extractName(html);
        const startAt = this.extractStartAt(html);

        if (!name || !startAt) {
            console.warn(`Missing required fields for event at ${url}: name = ${name}, startAt = ${startAt} `);
            return undefined;
        }

        let endAt = this.extractEndAt(html);
        if (endAt && startAt && (endAt < startAt)) {
            console.warn(`Event ${name} has endAt(${endAt}) before startAt(${startAt}).Setting endAt to undefined.`);
            endAt = undefined;
        }

        // everything on this site is from potsdam and some events dont have proper address so we add "potsdam" if they dont have it
        const address = this.extractAddress(html) || [];
        if (!address?.some(x => x.toLowerCase().includes("potsdam"))) address.push("Potsdam");
        const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');

        const price = this.extractPrice(html) ?? null;

        return {
            name,
            startAt,
            endAt,
            address,
            price,
            priceIsHtml: false, // GG Brandenburg doesn't seem to use HTML in price fields
            description: this.extractDescription(html) ?? null,
            imageUrls: this.extractImageUrls(html) || [],
            host: this.extractHost(html) ?? null,
            hostLink: this.extractHostLink(html) ?? null,
            sourceUrl: url,
            latitude: coordinates?.lat ?? null,
            longitude: coordinates?.lng ?? null,
            tags: this.extractTags(html) || [],
            source: 'ggbrandenburg',
        };
    }

    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];
        const currentPage = 1;
        let keepFetching = true;

        console.error("--- Starting GG Brandenburg Event Scraper (Web Mode) ---");

        while (keepFetching) {
            // For now, we'll just fetch the first page
            // TODO: Add pagination support if the website supports it
            const pageUrl = currentPage === 1 ?
                `${this.baseUrl}${this.startPath} ` :
                `${this.baseUrl}${this.startPath}?page = ${currentPage} `;

            console.error(`\n-- - Fetching Page ${currentPage}: ${pageUrl} --- `);

            await sleep(this.requestDelayMs);
            const pageHtml = await customFetch(pageUrl);
            if (!pageHtml) {
                console.error(`Failed to fetch page ${currentPage}.Stopping.`);
                keepFetching = false;
                break;
            }

            try {
                const eventUrls = await this.extractEventUrls(pageHtml);
                if (eventUrls.length === 0) {
                    console.error(`Stopped fetching: No events found on page ${currentPage}.`);
                    keepFetching = false;
                    break;
                }

                console.error(` Processing ${eventUrls.length} events from page ${currentPage}...`);
                for (const eventUrl of eventUrls) {
                    try {
                        await sleep(this.requestDelayMs);
                        const html = await customFetch(eventUrl);

                        if (!html) {
                            console.error(`Failed to fetch details for: ${eventUrl}. Skipping event.`);
                            continue;
                        }

                        const event = await this.extractEventData(html, eventUrl);
                        if (event) {
                            allEvents.push(event);
                            console.log(`✓ Processed: ${event.name} `, event);
                        } else {
                            console.warn(`Failed to get complete details for event: ${eventUrl} `);
                        }
                    } catch (error) {
                        console.error(`Error processing event item "${eventUrl}": `, error);
                    }
                }
            } catch (error) {
                console.error(`Error processing page ${currentPage}: `, error);
            }

            // For now, only process the first page
            // TODO: Implement proper pagination detection
            keepFetching = false;
        }

        console.error(`\n-- - Scraping finished.Total events collected: ${allEvents.length} --- `);
        return allEvents;
    }

    async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
        console.error(`-- - Starting GG Brandenburg Event Scraper(Local File Mode)-- - `);
        const allEvents: ScrapedEvent[] = [];

        for (const filePath of filePaths) {
            console.error(`Processing local HTML file: ${filePath}...`);
            try {
                const htmlContent = await Bun.file(filePath).text();
                const event = await this.extractEventData(htmlContent, filePath);
                if (event) {
                    if (!event.name || !event.startAt) {
                        console.warn(`Extracted event from ${filePath} is missing name or startAt.Outputting anyway.`);
                    }
                    allEvents.push(event);
                } else {
                    console.error(`Could not extract event data from ${filePath}.`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Error processing file ${filePath}: `, message);
                if (message.includes("ENOENT")) {
                    console.error(`Hint: Make sure the file path "${filePath}" is correct and the file exists.`);
                }
            }
        }
        console.error(`-- - Processed ${filePaths.length} files.Total events extracted: ${allEvents.length} --- `);
        return allEvents;
    }
}

if (import.meta.main) {
    const scraper = new GGBrandenburgScraper();
    if (process.argv.length > 2) {
        console.log(JSON.stringify(await scraper.scrapeHtmlFiles(process.argv.slice(2)), null, 2));
    } else {
        console.log(JSON.stringify(await scraper.scrapeWebsite(), null, 2));
    }
    process.exit(0);
} 