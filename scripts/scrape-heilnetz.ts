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
import * as cheerio from 'cheerio';
import {
    customFetch,
    makeAbsoluteUrl,
    WebsiteScraperInterface,
    REQUEST_DELAY_MS,
    cleanProseHtml,
    germanDateToIsoStr
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const BASE_URL = 'https://www.heilnetz.de';

interface EventOccurrence {
    url: string;
    date: string;
    time?: string;
    downloadLink?: string;
}

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const startUrl = 'https://www.heilnetz.de/aktuelle-termine.html';
        const allEvents: ScrapedEvent[] = [];
        let totalPages = 1;

        console.error(`Fetching initial listing page: ${startUrl}...`);
        let firstPageHtml: string;
        try {
            firstPageHtml = await customFetch(startUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to fetch initial page ${startUrl}:`, message);
            // If we can't fetch the first page, return empty array rather than exiting
            return [];
        }

        const $firstPage = cheerio.load(firstPageHtml);
        totalPages = this.getLastPageNumber($firstPage);
        console.error(`Found ${totalPages} total listing pages.`);

        const eventOccurrences: EventOccurrence[] = [];

        // Process page 1 for event occurrences
        console.error("Extracting event occurrences from page 1...");
        this.extractEventOccurrencesFromPage($firstPage, eventOccurrences);

        // Loop through remaining listing pages (2 to totalPages) to gather all event occurrences in parallel
        const pagePromises: Promise<EventOccurrence[]>[] = [];
        if (totalPages > 1) {
            for (let i = 2; i <= totalPages; i++) {
                const pageUrl = `${startUrl}?page_e2=${i}`;
                pagePromises.push(
                    (async () => {
                        console.error(`Fetching listing page ${i}: ${pageUrl}...`);
                        try {
                            const currentPageHtml = await customFetch(pageUrl);
                            const $currentPage = cheerio.load(currentPageHtml);
                            const occurrencesOnPage: EventOccurrence[] = [];
                            console.error(`Extracting event occurrences from page ${i}...`);
                            this.extractEventOccurrencesFromPage($currentPage, occurrencesOnPage);
                            return occurrencesOnPage;
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            console.error(`Error processing listing page ${i} (${pageUrl}): ${message}. Skipping this page.`);
                            return []; // Return empty array on error for this page
                        }
                    })()
                );
            }
        }

        if (pagePromises.length > 0) {
            const settledPromises = await Promise.allSettled(pagePromises);
            settledPromises.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    eventOccurrences.push(...result.value);
                } else {
                    console.error(`Failed to process page ${index + 2}: ${result.reason}`);
                }
            });
        }

        console.error(`Found ${eventOccurrences.length} event occurrences to process.`);

        // Now, fetch and process each event detail page sequentially
        for (const occurrence of eventOccurrences) {
            console.error(`Fetching and processing event detail page: ${occurrence.url}...`);
            try {
                let eventHtml: string;
                try {
                    eventHtml = await customFetch(occurrence.url);
                } catch (error) {
                    void error; // Mark as intentionally unused
                    console.error(`Skipping event detail page ${occurrence.url} due to fetch error.`);
                    continue; // Skip to next event URL
                }

                const event = await this.extractEventData(eventHtml, occurrence.url, occurrence.date, occurrence.time, occurrence.downloadLink);
                if (event) {
                    console.log(event);
                    allEvents.push(event);
                }
            } catch (error) {
                console.error(`Failed to process event detail page ${occurrence.url}:`, error);
                // Continue to next event, don't break the loop
            }

            // Add a delay between requests to be polite to the server
            await Bun.sleep(REQUEST_DELAY_MS);
        }

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    /**
     * Extracts event occurrences from a listing page, including their dates and times.
     * @param $ Cheerio instance loaded with the HTML of a listing page
     * @param occurrences Array to populate with event occurrences
     */
    private extractEventOccurrencesFromPage($: cheerio.CheerioAPI, occurrences: EventOccurrence[]): void {
        // Find all accordion items (each represents an event occurrence)
        $('.accordion-item').each((_i, accordionItem) => {
            const $item = $(accordionItem);

            // Extract the date from the datetime attribute
            const $timeElement = $item.find('time[datetime]');
            if ($timeElement.length === 0) return;

            const datetime = $timeElement.attr('datetime');
            if (!datetime) return;

            // Parse the datetime to get the date
            const dateMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
            if (!dateMatch) return;

            const isoDate = dateMatch[1];
            const [year, month, day] = isoDate.split('-').map(Number);
            const dateString = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;

            // Extract time from the clock icon text
            const timeText = $item.find('.bi-clock').parent().text().trim();
            const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : undefined;

            // Extract the event URL from the permalink
            const $permalink = $item.find('a[href^="/termin/"]').last();
            if ($permalink.length === 0) return;

            const link = $permalink.attr('href');
            if (!link) return;

            const absoluteUrl = makeAbsoluteUrl(link, BASE_URL);
            if (!absoluteUrl) return;

            // Extract download link if available
            const $downloadLink = $item.find('a[href*="files/anbieterinnen"][target="_blank"]');
            let downloadLink: string | undefined;
            if ($downloadLink.length > 0) {
                const downloadHref = $downloadLink.attr('href');
                if (downloadHref) {
                    downloadLink = makeAbsoluteUrl(downloadHref, BASE_URL);
                }
            }

            occurrences.push({
                url: absoluteUrl,
                date: dateString,
                time: time,
                downloadLink: downloadLink
            });
        });
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

    async extractEventData(html: string, url: string, eventDate?: string, eventTime?: string, downloadLink?: string): Promise<ScrapedEvent | undefined> {
        try {
            const name = this.extractName(html);
            const startAt = this.extractStartAt(html, eventDate, eventTime);
            if (!name || !startAt) {
                console.error(`Skipping event from ${url} due to missing name or start date.`);
                return undefined;
            }

            const address = this.extractAddress(html) || [];
            const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');

            return {
                name,
                startAt,
                endAt: this.extractEndAt(html, eventDate),
                address,
                price: this.extractPrice(html),
                priceIsHtml: false,
                description: this.extractDescription(html, downloadLink) || '',
                imageUrls: this.extractImageUrls(html) || [],
                host: this.extractHost(html),
                hostLink: this.extractHostLink(html),
                sourceUrl: url,
                latitude: coordinates?.lat || null,
                longitude: coordinates?.lng || null,
                tags: this.extractTags(html) || [],
                source: 'heilnetz',
            };
        } catch (error) {
            console.error(`Error extracting event data from ${url}:`, error);
            return undefined;
        }
    }

    extractName(html: string): string | undefined {
        const $ = cheerio.load(html);

        let name: string | undefined;
        $('script[type="application/ld+json"]').each((_i, el) => {
            try {
                const jsonData = JSON.parse($(el).html() || '');
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'Event' && item.name) {
                        name = item.name;
                        return false;
                    }
                }
            } catch (_) {
                void _;
                // Silently continue on JSON parse error
            }
        });

        if (!name) {
            name = $('h1.px-md-0').first().text().trim();
        }

        return name;
    }

    extractStartAt(html: string, eventDate?: string, eventTime?: string) {
        const $ = cheerio.load(html);

        // If we have a specific event date from the listing page, use it
        if (eventDate) {
            // Extract time from the detail page if not provided
            if (!eventTime) {
                eventTime = this.extractTimeFromDetailPage($);
            }

            const [day, month, year] = eventDate.split('.').map(Number);
            if (eventTime) {
                const [hour, minute] = eventTime.split(':').map(Number);
                return germanDateToIsoStr(year, month - 1, day, hour, minute);
            } else {
                return germanDateToIsoStr(year, month - 1, day);
            }
        }

        return undefined;
    }

    /**
     * Extracts the time from the "Uhrzeit:" field in the event detail page.
     * @param $ Cheerio instance loaded with the event detail page HTML
     * @returns Time string in HH:MM format or undefined if not found
     */
    private extractTimeFromDetailPage($: cheerio.CheerioAPI): string | undefined {
        const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();
        if ($table.length) {
            const timeText = this.getTableCellValueByLabel($, $table, 'Uhrzeit:');
            if (timeText) {
                // Extract the start time from formats like "11:00 - 14:00 Uhr" or "18:30 - 19:30"
                const timeMatch = timeText.match(/(\d{1,2}:\d{2})/);
                return timeMatch ? timeMatch[1] : undefined;
            }
        }
        return undefined;
    }

    extractEndAt(html: string, eventDate?: string) {
        const $ = cheerio.load(html);

        const timeText = $('td:contains("Uhrzeit")').next().text().trim();
        const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        const endTime = timeMatch ? timeMatch[2] : undefined;
        const endHour = endTime ? parseInt(endTime.split(':')[0], 10) : undefined;
        const endMinute = endTime ? parseInt(endTime.split(':')[1], 10) : undefined;

        if (endTime && eventDate) {
            const [day, month, year] = eventDate.split('.').map(Number);
            return germanDateToIsoStr(year, month - 1, day, endHour, endMinute);
        }

        return undefined;
    }

    extractAddress(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();

        if ($table.length) {
            const rawOrtHtml = this.getTableCellValueByLabel($, $table, 'Ort:', true);
            return this.parseAddress(rawOrtHtml);
        }

        return [];
    }

    extractPrice(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();

        if ($table.length) {
            const rawPrice = this.getTableCellValueByLabel($, $table, 'Kosten');
            return rawPrice ? rawPrice.trim() : undefined;
        }

        return undefined;
    }

    extractDescription(html: string, downloadLink?: string): string | undefined {
        const $ = cheerio.load(html);

        // First try LD+JSON
        let description: string | undefined;
        $('script[type="application/ld+json"]').each((_i, el) => {
            try {
                const jsonData = JSON.parse($(el).html() || '');
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'Event' && item.description) {
                        description = item.description;
                        return false;
                    }
                }
            } catch (_) {
                void _;
                // Silently continue on JSON parse error
            }
        });

        if (description && typeof description === 'string') {
            description = description.replace(/\n<p>\n<p>/g, '\n<p>').replace(/<p>\n<p>/g, '<p>');
        }

        // Add download link if available
        if (downloadLink) {
            if (description) {
                description += `<p><a href="${downloadLink}" target="_blank">Mehr Infos</a></p>`;
            }
        }

        return cleanProseHtml(description);
    }

    extractImageUrls(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const imageUrls: string[] = [];

        $('script[type="application/ld+json"]').each((_i, el) => {
            try {
                const jsonData = JSON.parse($(el).html() || '');
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'ImageObject' && item.contentUrl) {
                        const imageUrl = makeAbsoluteUrl(item.contentUrl, BASE_URL);
                        if (imageUrl) {
                            imageUrls.push(imageUrl);
                        }
                    }

                    if (item['@type'] === 'Event') {
                        if (item.image) {
                            if (typeof item.image === 'string') {
                                const imageUrl = makeAbsoluteUrl(item.image, BASE_URL);
                                if (imageUrl) {
                                    imageUrls.push(imageUrl);
                                }
                            } else if (item.image.url) {
                                const imageUrl = makeAbsoluteUrl(item.image.url, BASE_URL);
                                if (imageUrl) {
                                    imageUrls.push(imageUrl);
                                }
                            }
                        }
                    }
                }
            } catch (_) {
                void _;
                // Silently handle JSON parsing errors
            }
        });

        // Look for images in the HTML content
        if (imageUrls.length === 0) {
            $('.mod_eventreader .col-12.col-lg-7 img').each((_i, el) => {
                const src = $(el).attr('src');
                if (src) {
                    const imageUrl = makeAbsoluteUrl(src, BASE_URL);
                    if (imageUrl && !imageUrls.includes(imageUrl)) {
                        imageUrls.push(imageUrl);
                    }
                }
            });

            // If still no images, try a broader search
            if (imageUrls.length === 0) {
                $('.mod_eventreader img').each((_i, el) => {
                    const src = $(el).attr('src');
                    if (src) {
                        const imageUrl = makeAbsoluteUrl(src, BASE_URL);
                        if (imageUrl) {
                            imageUrls.push(imageUrl);
                        }
                    }
                });
            }
        }

        return imageUrls;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();

        if ($table.length) {
            const leitung = this.getTableCellValueByLabel($, $table, 'Leitung:');
            const anbieterRawHtml = this.getTableCellValueByLabel($, $table, 'Anbieter:in:', true);

            if (anbieterRawHtml) {
                const $anbieterContent = cheerio.load(`<div>${anbieterRawHtml}</div>`);
                const providerLink = $anbieterContent('a').first();

                if (providerLink.length > 0) {
                    const href = providerLink.attr('href');
                    if (href && !href.startsWith('mailto:')) {
                        const linkText = providerLink.text().trim();
                        if (linkText) {
                            return linkText;
                        }
                    }
                }

                // Fallback to Leitung
                if (leitung) {
                    return leitung;
                }
            } else if (leitung) {
                return leitung;
            }
        }

        return undefined;
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();

        if ($table.length) {
            const anbieterRawHtml = this.getTableCellValueByLabel($, $table, 'Anbieter:in:', true);

            if (anbieterRawHtml) {
                const $anbieterContent = cheerio.load(`<div>${anbieterRawHtml}</div>`);
                const providerLink = $anbieterContent('a').first();

                if (providerLink.length > 0) {
                    const href = providerLink.attr('href');
                    if (href && !href.startsWith('mailto:')) {
                        return makeAbsoluteUrl(href, BASE_URL);
                    }
                }
            }
        }

        return undefined;
    }

    extractTags(_html: string): string[] | undefined {
        return [];
    }

    /**
     * Extracts the last page number from the pagination block.
     * @param $ CheerioAPI instance loaded with the HTML of a page containing pagination.
     * @returns The last page number, or 1 if pagination is not found.
     */
    private getLastPageNumber($: cheerio.CheerioAPI | cheerio.Root): number {
        const paginationEndLink = $('nav[aria-label="Pagination"] a[aria-label="Ende"]');
        if (paginationEndLink.length > 0) {
            const href = paginationEndLink.attr('href');
            if (href) {
                const match = href.match(/page_e2=(\\d+)/);
                if (match && match[1]) {
                    return parseInt(match[1], 10);
                }
            }
            const lastPageItem = $('nav[aria-label="Pagination"] .page-item:not(.d-none) a.page-link').last();
            // Try to get the page number before "Ende", which is usually the second to last visible item
            const prevPageItem = $('nav[aria-label="Pagination"] .page-item:not(.d-none):nth-last-child(2) a.page-link');
            const lastPageText = prevPageItem.text().trim() || lastPageItem.text().trim();

            const lastPageNum = parseInt(lastPageText, 10);
            if (!isNaN(lastPageNum)) {
                return lastPageNum;
            }
        }
        // Fallback: if "Ende" is not found or unparsable, count active page items
        const pageLinks = $('nav[aria-label="Pagination"] .page-item:not(.d-none) a.page-link');
        const numbers = pageLinks.map((_i, el) => parseInt($(el).text().trim(), 10)).get().filter(n => !isNaN(n));
        if (numbers.length > 0) return Math.max(...numbers);

        console.warn("Could not determine last page number from pagination. Assuming only one page.");
        return 1; // Default to 1 if pagination or last page number isn't found
    }

    /**
     * Extracts text or HTML content of the next TD element after a TD containing a specific label.
     * @param $ Cheerio instance.
     * @param tableEl The Cheerio element for the table to search within.
     * @param labelText The text of the <strong> tag inside the label TD (e.g., "Ort:", "Kosten:").
     * @param returnHtml If true, returns inner HTML, otherwise returns text.
     * @returns The cleaned text/HTML content or null if not found.
     */
    private getTableCellValueByLabel(
        $: cheerio.CheerioAPI | cheerio.Root,
        tableEl: cheerio.Cheerio,
        labelText: string,
        returnHtml = false
    ): string | null {
        let foundValue: string | null = null;
        tableEl.find('tr').each((_i, tr) => {
            const $tr = $(tr);

            // First, try to find by strong tag inside td (most cells)
            let labelTd = $tr.find('td > strong').filter((_idx, strongEl) => {
                return $(strongEl).text().trim().startsWith(labelText);
            }).parent('td');

            // If not found, try to find by direct td text (e.g., Anbieter:in:)
            if (labelTd.length === 0) {
                labelTd = $tr.find('td').filter((_idx, tdEl) => {
                    return $(tdEl).text().trim().startsWith(labelText);
                });
            }

            if (labelTd.length > 0) {
                const valueTd = labelTd.next('td');
                if (valueTd.length > 0) {
                    foundValue = returnHtml ? valueTd.html() : valueTd.text();
                    if (foundValue) foundValue = foundValue.trim();
                    return false; // Break .each loop
                }
            }
        });
        return foundValue;
    }

    /**
     * Parses address details from HTML string (typically from the "Ort:" cell).
     * @param rawHtmlLocationString Raw HTML from the "Ort:" section.
     * @returns An array of address lines (street, postalCode/city) without the venue name.
     */
    private parseAddress(rawHtmlLocationString: string | null): string[] {
        if (!rawHtmlLocationString) return [];

        // Replace <br> tags with actual newlines
        const htmlWithNewlines = rawHtmlLocationString.replace(/<br\s*\/?>/gi, '\n');

        // Load into cheerio to strip remaining tags and get text
        const $temp = cheerio.load(`<div>${htmlWithNewlines}</div>`);
        const textContent = $temp('div').text();

        // Split by newlines, trim, and filter empty lines
        const allLines = textContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        // Skip the first line as it's typically the venue name, not part of the physical address
        // Only return subsequent lines which contain the street, postal code, city
        return allLines.length > 1 ? allLines.slice(1) : allLines;
    }
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
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}
