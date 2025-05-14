/**
 * Fetches event pages from heilnetz.de (starting from https://heilnetz.de/aktuelle-termine.html)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from heilnetz.de:
 * - Iterates through all pagination pages.
 * - Fetches each event's detail page.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prioritizes data from LD+JSON script tags if available.
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
    fetchWithTimeout,
    makeAbsoluteUrl as makeAbsoluteUrlCommon,
    geocodeAddressFromEvent,
    WebsiteScraper,
    REQUEST_DELAY_MS
} from "./common.ts";

const BASE_URL = 'https://www.heilnetz.de';

/**
 * Wrapper around the common makeAbsoluteUrl function to maintain
 * compatibility with existing code.
 */
function makeAbsoluteUrl(url: string | undefined, baseUrl: string): string | undefined {
    return makeAbsoluteUrlCommon(url, baseUrl);
}

export class HeilnetzScraper implements WebsiteScraper {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const startUrl = 'https://www.heilnetz.de/aktuelle-termine.html';
        const allEvents: ScrapedEvent[] = [];
        let totalPages = 1;

        console.error(`Fetching initial listing page: ${startUrl}...`);
        let firstPageHtml: string;
        try {
            firstPageHtml = await fetchWithTimeout(startUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to fetch initial page ${startUrl}:`, message);
            // If we can't fetch the first page, return empty array rather than exiting
            return [];
        }

        const $firstPage = cheerio.load(firstPageHtml);
        totalPages = this.getLastPageNumber($firstPage);
        console.error(`Found ${totalPages} total listing pages.`);

        const eventDetailUrlSet = new Set<string>();

        // Process page 1 for event URLs
        console.error("Extracting event URLs from page 1...");
        $firstPage('a[href^="/termin/"]').each((_i, el) => {
            const link = $firstPage(el).attr('href');
            if (link) {
                const absoluteUrl = makeAbsoluteUrl(link, BASE_URL);
                if (absoluteUrl) {
                    eventDetailUrlSet.add(absoluteUrl);
                }
            }
        });

        // Loop through remaining listing pages (2 to totalPages) to gather all event URLs in parallel
        const pagePromises: Promise<string[]>[] = [];
        if (totalPages > 1) {
            for (let i = 2; i <= totalPages; i++) {
                const pageUrl = `${startUrl}?page_e2=${i}`;
                pagePromises.push(
                    (async () => {
                        console.error(`Fetching listing page ${i}: ${pageUrl}...`);
                        try {
                            const currentPageHtml = await fetchWithTimeout(pageUrl);
                            const $currentPage = cheerio.load(currentPageHtml);
                            const urlsOnPage: string[] = [];
                            console.error(`Extracting event URLs from page ${i}...`);
                            $currentPage('a[href^="/termin/"]').each((_idx, el) => {
                                const link = $currentPage(el).attr('href');
                                if (link) {
                                    const absoluteUrl = makeAbsoluteUrl(link, BASE_URL);
                                    if (absoluteUrl) {
                                        urlsOnPage.push(absoluteUrl);
                                    }
                                }
                            });
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
                    result.value.forEach(url => eventDetailUrlSet.add(url));
                } else {
                    console.error(`Failed to process page ${index + 2}: ${result.reason}`);
                }
            });
        }

        const eventDetailUrls = Array.from(eventDetailUrlSet);
        console.error(`Found ${eventDetailUrls.length} unique event detail URLs to process.`);

        // Now, fetch and process each event detail page sequentially
        for (const detailUrl of eventDetailUrls) {
            console.error(`Fetching and processing event detail page: ${detailUrl}...`);
            try {
                let eventHtml: string;
                try {
                    eventHtml = await fetchWithTimeout(detailUrl);
                } catch (error) {
                    void error; // Mark as intentionally unused
                    console.error(`Skipping event detail page ${detailUrl} due to fetch error.`);
                    continue; // Skip to next event URL
                }

                const event = await this.extractEventData(eventHtml, detailUrl);
                if (event) {
                    allEvents.push(event);
                }
            } catch (error) {
                console.error(`Failed to process event detail page ${detailUrl}:`, error);
                // Continue to next event, don't break the loop
            }

            // Add a delay between requests to be polite to the server
            await Bun.sleep(REQUEST_DELAY_MS);
        }

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
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
        try {
            const name = this.extractName(html);
            const startAt = this.extractStartAt(html);
            if (!name || !startAt) {
                console.error(`Skipping event from ${url} due to missing name or start date.`);
                return undefined;
            }

            const address = this.extractAddress(html) || [];
            const coordinates = await geocodeAddressFromEvent(address);

            return {
                name,
                startAt,
                endAt: this.extractEndAt(html),
                address,
                price: this.extractPrice(html),
                description: this.extractDescription(html) || '',
                imageUrls: this.extractImageUrls(html) || [],
                host: this.extractHost(html),
                hostLink: this.extractHostLink(html),
                permalink: url,
                latitude: coordinates?.lat || null,
                longitude: coordinates?.lng || null,
                tags: this.extractTags(html) || [],
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
                // Silently continue on JSON parse error
            }
        });

        if (!name) {
            name = $('h1.px-md-0').first().text().trim();
        }

        return name;
    }

    extractStartAt(html: string): Date | undefined {
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
                // Silently continue on JSON parse error
            }
        });

        if (startDate) {
            try {
                return new Date(startDate);
            } catch (_) {
                console.error(`Error parsing start date from LD+JSON: ${startDate}`);
            }
        }

        return undefined;
    }

    extractEndAt(html: string): Date | undefined {
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
                // Silently continue on JSON parse error
            }
        });

        if (endDate) {
            try {
                return new Date(endDate);
            } catch (_) {
                console.error(`Error parsing end date from LD+JSON: ${endDate}`);
            }
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

    extractDescription(html: string): string | undefined {
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
                // Silently continue on JSON parse error
            }
        });

        if (!description) {
            const htmlDesc = this.extractHtmlDescription($);
            description = htmlDesc === null ? undefined : htmlDesc;
        }

        if (description && typeof description === 'string') {
            description = description.replace(/\n<p>\n<p>/g, '\n<p>').replace(/<p>\n<p>/g, '<p>');
        }

        return description;
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

    extractTags(html: string): string[] | undefined {
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
     * Extracts and cleans the event description HTML from the main content area.
     * This is a fallback if LD+JSON description is not available or insufficient.
     */
    private extractHtmlDescription($: cheerio.CheerioAPI | cheerio.Root): string | null {
        // Selector for the description container based on the new example page
        const descriptionContainer = $('.mod_eventreader .col-12.col-lg-7').first();
        if (!descriptionContainer.length) return null;

        // The actual content seems to be within a div, then paragraphs or other elements
        // We take the div that is a direct child of descriptionContainer, or descriptionContainer itself
        const contentHolder = descriptionContainer.children('div').first().length ? descriptionContainer.children('div').first() : descriptionContainer;

        let descriptionHtml = '';
        // Iterate over direct children of the content holder
        contentHolder.children().each((_i, el) => {
            const $el = $(el);
            // Avoid shariff buttons or other non-description elements if they appear
            if ($el.hasClass('shariff')) {
                return false; // Stop .each loop
            }
            descriptionHtml += $.html($el)?.trim() + '\n';
        });

        return descriptionHtml.trim() || null;
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
        const scraper = new HeilnetzScraper();
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
