/**
 * Fetches event pages from heilnetz-owl.de (starting from https://www.heilnetz-owl.de/kurse-seminare)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from heilnetz-owl.de:
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
 *   To scrape from the web: bun run scripts/scrape-heilnetzowl.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-heilnetzowl.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';
import {
    customFetch,
    makeAbsoluteUrl,
    WebsiteScraper,
    REQUEST_DELAY_MS,
    superTrim,
    cleanProseHtml,
    germanDateToIsoStr
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const BASE_URL = 'https://www.heilnetz-owl.de';

/**
 * Interface for event URL with date information
 */
interface EventUrlWithDate {
    url: string;
    date: string;
    title: string;
    host: string;
    downloadLink?: string;
}

export class HeilnetzOwlScraper implements WebsiteScraper {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const startUrl = 'https://www.heilnetz-owl.de/kurse-seminare';
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

        const eventDetailUrlsWithDates: EventUrlWithDate[] = [];

        // Process page 1 for event URLs with dates
        console.error("Extracting event URLs from page 1...");
        this.extractEventUrlsWithDates($firstPage, eventDetailUrlsWithDates);

        // Loop through remaining listing pages (2 to totalPages) to gather all event URLs in parallel
        const pagePromises: Promise<EventUrlWithDate[]>[] = [];
        if (totalPages > 1) {
            for (let i = 2; i <= totalPages; i++) {
                const pageUrl = `${startUrl}?page_e2=${i}`;
                pagePromises.push(
                    (async () => {
                        console.error(`Fetching listing page ${i}: ${pageUrl}...`);
                        try {
                            const currentPageHtml = await customFetch(pageUrl);
                            const $currentPage = cheerio.load(currentPageHtml);
                            const urlsOnPage: EventUrlWithDate[] = [];
                            console.error(`Extracting event URLs from page ${i}...`);
                            this.extractEventUrlsWithDates($currentPage, urlsOnPage);
                            return urlsOnPage;
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
                    eventDetailUrlsWithDates.push(...result.value);
                } else {
                    console.error(`Failed to process page ${index + 2}: ${result.reason}`);
                }
            });
        }

        console.error(`Found ${eventDetailUrlsWithDates.length} event occurrences to process.`);

        // Now, fetch and process each event detail page sequentially
        for (const eventInfo of eventDetailUrlsWithDates) {
            console.error(`Fetching and processing event detail page: ${eventInfo.url} (${eventInfo.date})...`);
            try {
                let eventHtml: string;
                try {
                    eventHtml = await customFetch(eventInfo.url);
                } catch (error) {
                    void error; // Mark as intentionally unused
                    console.error(`Skipping event detail page ${eventInfo.url} due to fetch error.`);
                    continue; // Skip to next event URL
                }

                const event = await this.extractEventData(eventHtml, eventInfo.url, eventInfo.date, eventInfo.downloadLink);
                if (event) {
                    console.log(event);
                    allEvents.push(event);
                } else {
                    console.error(`Skipping event detail page ${eventInfo.url} due to missing event data.`);
                }
            } catch (error) {
                console.error(`Failed to process event detail page ${eventInfo.url}:`, error);
                // Continue to next event, don't break the loop
            }

            // Add a delay between requests to be polite to the server
            await Bun.sleep(REQUEST_DELAY_MS);
        }

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    /**
     * Extracts event URLs with their associated date information from a listing page
     */
    private extractEventUrlsWithDates($: cheerio.CheerioAPI | cheerio.Root, eventUrlsWithDates: EventUrlWithDate[]): void {
        // Find all accordion items that contain event information
        $('.accordion-item').each((_i, accordionItem) => {
            const $item = $(accordionItem);

            // Extract the date from the time element
            const $timeElement = $item.find('time[datetime]');
            if ($timeElement.length === 0) return;

            const dateTime = $timeElement.attr('datetime');
            if (!dateTime) return;

            // Extract the event title
            const $titleElement = $item.find('.col-8.col-md-8.ps-0 > div').first();
            const title = $titleElement.text().trim();
            if (!title) return;

            // Extract the host/instructor - look for text after the person icon
            const $hostElement = $item.find('.bi-person').parent();
            const hostText = $hostElement.text().trim();
            // Extract the host name by finding text after the person icon
            const host = hostText.replace(/^.*?(\S+.*)$/, '$1').trim();

            // Find the permalink
            const $permalinkLink = $item.find('a[href^="/termin/"]');
            if ($permalinkLink.length === 0) return;

            const permalink = $permalinkLink.attr('href');
            if (!permalink) return;

            const absoluteUrl = makeAbsoluteUrl(permalink, BASE_URL);
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

            eventUrlsWithDates.push({
                url: absoluteUrl,
                date: dateTime,
                title,
                host,
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

    async extractEventData(html: string, url: string, eventDate?: string, downloadLink?: string): Promise<ScrapedEvent | undefined> {
        try {
            const name = this.extractName(html);
            let startAt = this.extractStartAt(html);
            // For recurring events, combine the date from the listing page with the time from the detail page
            if (eventDate) {
                const time = this.extractTime(html);
                if (time) {
                    // Combine date from listing page with time from detail page using proper timezone
                    // eventDate format: "2025-07-01" or "2025-07-01T16:45:00+02:00"
                    let dateOnly = eventDate;
                    if (eventDate.includes('T')) {
                        dateOnly = eventDate.split('T')[0];
                    }

                    // Parse the date and time components
                    const [year, month, day] = dateOnly.split('-').map(Number);
                    const [hour, minute] = time.split(':').map(Number);
                    // Create ISO string with proper timezone offset (month is 0-indexed in germanDateToIsoStr)
                    startAt = germanDateToIsoStr(year, month - 1, day, hour, minute);
                } else {
                    // Fallback to just the date if no time found - use germanDateToIsoStr with 0-indexed month
                    let dateOnly = eventDate;
                    if (eventDate.includes('T')) {
                        dateOnly = eventDate.split('T')[0];
                    }
                    const [year, month, day] = dateOnly.split('-').map(Number);
                    startAt = germanDateToIsoStr(year, month - 1, day);
                }
            }

            if (!name || !startAt) {
                console.error(`Skipping event from ${url} due to missing name or start date.`);
                return undefined;
            }

            const address = this.extractAddress(html) || [];
            const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');

            return {
                name,
                startAt,
                endAt: this.extractEndAt(html),
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
                tags: this.extractTags(),
                source: 'heilnetzowl',
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

    extractStartAt(html: string) {
        const $ = cheerio.load(html);

        let startDate: string | undefined;
        $('script[type="application/ld+json"]').each((_i, el) => {
            try {
                const jsonData = JSON.parse($(el).html() || '');
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'Event' && item.startDate) {
                        startDate = item.startDate;
                        return false;
                    }
                }
            } catch (_) {
                void _;
                // Silently continue on JSON parse error
            }
        });

        if (startDate) {
            try {
                return startDate;
            } catch (_) {
                void _;
                console.error(`Error parsing start date from LD+JSON: ${startDate}`);
            }
        }

        return undefined;
    }

    extractEndAt(html: string) {
        const $ = cheerio.load(html);

        let endDate: string | undefined;
        $('script[type="application/ld+json"]').each((_i, el) => {
            try {
                const jsonData = JSON.parse($(el).html() || '');
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'Event' && item.endDate) {
                        endDate = item.endDate;
                        return false;
                    }
                }
            } catch (_) {
                void _;
                // Silently continue on JSON parse error
            }
        });

        if (endDate) {
            try {
                return endDate;
            } catch (_) {
                void _;
                console.error(`Error parsing end date from LD+JSON: ${endDate}`);
            }
        }

        return undefined;
    }

    extractAddress(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const $table = $('main section table').first();

        if ($table.length) {
            const rawOrtHtml = this.getTableCellValueByLabel($, $table, 'Ort:', true);
            return this.parseAddress(rawOrtHtml);
        }

        return [];
    }

    extractPrice(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('main section table').first();

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

        const $table = $('main section table').first();

        // add extras info
        const extrasInfo = this.getTableCellValueByLabel($, $table, 'Extras', true);
        if (extrasInfo) description += `<p>${extrasInfo.replaceAll('\n', '')}</p>`;

        // Add download link if available
        if (downloadLink) {
            description += `<p><a href="${downloadLink}" target="_blank">Mehr Infos</a></p>`;
        }

        // add kontakt info        
        const organizerInfoHtml = this.getTableCellValueByLabel($, $table, 'Anbieter*in:', true);
        let organizerInfoText = superTrim(this.getTableCellValueByLabel($, $table, 'Anbieter*in:', false));
        const email = organizerInfoHtml?.match(/<a href="mailto:([^"]+)"/)?.[1] ?? '';
        organizerInfoText = organizerInfoText?.replaceAll(email.trim(), "")
        organizerInfoText = organizerInfoText?.replaceAll((this.extractHost(html) ?? '').trim(), "")
        if (email || organizerInfoText) {
            description += `<p><strong>Kontakt:</strong><br>`
            if (email) description += `<a href="mailto:${email}">${email}</a><br>`
            if (organizerInfoText) {
                if (!/[a-zA-Z]/.test(organizerInfoText)) {
                    // its a phone number!
                    description += `<a href="tel:${organizerInfoText}">${organizerInfoText}</a>`
                } else {
                    description += organizerInfoText
                }
            }
            description += `</p>`
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

                // First pass: collect all ImageObjects with their @id
                const imageObjects = new Map<string, string>();
                for (const item of eventsArray) {
                    if (item['@type'] === 'ImageObject' && item['@id'] && item.contentUrl) {
                        const imageId = item['@id'];
                        const imageUrl = makeAbsoluteUrl(item.contentUrl, BASE_URL);
                        if (imageUrl) {
                            imageObjects.set(imageId, imageUrl);
                        }
                    }
                }

                // Second pass: find Event objects and extract their images
                for (const item of eventsArray) {
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
                            } else if (item.image['@id']) {
                                // Handle case where image is referenced by @id
                                const imageId = item.image['@id'];
                                const imageUrl = imageObjects.get(imageId);
                                if (imageUrl) {
                                    imageUrls.push(imageUrl);
                                }
                            } else if (item.image.contentUrl) {
                                // Handle case where image object has contentUrl directly
                                const imageUrl = makeAbsoluteUrl(item.image.contentUrl, BASE_URL);
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

        return imageUrls;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('main section table').first();

        if ($table.length) {
            const leitung = this.getTableCellValueByLabel($, $table, 'Leitung:');
            const anbieterRawHtml = this.getTableCellValueByLabel($, $table, 'Anbieter*in:', true);

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
        const $table = $('main section table').first();

        if ($table.length) {
            const anbieterRawHtml = this.getTableCellValueByLabel($, $table, 'Anbieter*in:', true);

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

    extractTags(): string[] {
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

    extractTime(html: string): string | undefined {
        const $ = cheerio.load(html);
        const $table = $('main section table').first();

        if ($table.length) {
            const timeValue = this.getTableCellValueByLabel($, $table, 'Uhrzeit:');
            if (timeValue) {
                // Extract the start time from formats like "16:45 - 18:00 Uhr" or "19:00 - 20:30"
                const timeMatch = timeValue.match(/(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    return timeMatch[1];
                }
            }
        }

        return undefined;
    }
}

// Execute the main function only when run directly
if (import.meta.main) {
    try {
        const scraper = new HeilnetzOwlScraper();
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
