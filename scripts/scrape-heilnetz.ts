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
 *   To parse a local file:  bun run scripts/scrape-heilnetz.ts <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';
import { geocodeLocation } from '../src/lib/common.ts';
import { db, eq } from '../src/lib/server/db.ts';
import { geocodeCache } from '../src/lib/server/schema.ts';

const BASE_URL = 'https://www.heilnetz.de';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Tries to make a URL absolute if it's relative (starts with /).
 * @param url The URL string.
 * @param baseUrl The base URL to prepend.
 * @returns Absolute URL or the original URL if it's already absolute or not a valid relative path.
 */
function makeAbsoluteUrl(url: string | undefined, baseUrl: string): string | undefined {
    if (!url) return undefined; // Changed from returning url to undefined for clarity

    if (url.startsWith('/')) {
        return baseUrl + url;
    }

    // Check if URL doesn't start with http:// or https:// and is not a mailto or tel link
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('mailto:') && !url.startsWith('tel:')) {
        // check if it's a relative path without leading slash
        if (!url.includes(':') && !url.startsWith('#')) { // simple check to avoid mangling full URLs without scheme
            return baseUrl + '/' + url;
        }
    }

    return url;
}

/**
 * Extracts text or HTML content of the next TD element after a TD containing a specific label.
 * @param $ CheerioAPI instance.
 * @param tableEl The Cheerio element for the table to search within.
 * @param labelText The text of the <strong> tag inside the label TD (e.g., "Ort:", "Kosten:").
 * @param returnHtml If true, returns inner HTML, otherwise returns text.
 * @returns The cleaned text/HTML content or null if not found.
 */
function getTableCellValueByLabel(
    $: cheerio.Root,
    tableEl: cheerio.Cheerio<cheerio.Element>,
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
function parseAddress(rawHtmlLocationString: string | null): string[] {
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

/**
 * Extracts and cleans the event description HTML from the main content area.
 * This is a fallback if LD+JSON description is not available or insufficient.
 */
function extractHtmlDescription($: cheerio.Root): string | null {
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

// parseDateTimeRange is removed as LD+JSON provides full ISO dates.
// If HTML fallback is needed later, it can be re-added/modified.

// --- Helper Functions ---

/**
 * Fetches HTML content from a URL.
 * @param url The URL to fetch.
 * @returns Promise resolving to the HTML text content.
 */
async function fetchHtml(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return await response.text();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error fetching URL "${url}":`, message);
        throw error; // Re-throw the error to allow main script to handle
    }
}

/**
 * Extracts the last page number from the pagination block.
 * @param $ CheerioAPI instance loaded with the HTML of a page containing pagination.
 * @returns The last page number, or 1 if pagination is not found.
 */
function getLastPageNumber($: cheerio.Root): number {
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
 * Geocodes a location address and returns latitude and longitude.
 * First checks the database cache, then calls the geocoding API if not found.
 * @param addressLines Array of address lines to geocode.
 * @returns Promise resolving to coordinates object or null if geocoding failed.
 */
async function geocodeAddressFromEvent(addressLines: string[]): Promise<{ lat: number; lng: number } | null> {
    if (!addressLines.length) return null;

    // Join the address lines to create a complete address string
    const addressString = addressLines.join(', ');

    try {
        // First, check the cache
        const cachedResult = await db.select()
            .from(geocodeCache)
            .where(eq(geocodeCache.address, addressString))
            .limit(1);

        if (cachedResult.length > 0) {
            console.error(`Found cached geocoding result for "${addressString}"`);
            return {
                lat: Number(cachedResult[0].latitude),
                lng: Number(cachedResult[0].longitude)
            };
        }

        // If not in cache, use the geocoding API
        const coordinates = await geocodeLocation(addressString, GOOGLE_MAPS_API_KEY || '');

        // If successful, store in cache
        if (coordinates) {
            try {
                await db.insert(geocodeCache).values({
                    address: addressString,
                    latitude: coordinates.lat,
                    longitude: coordinates.lng,
                });
                console.error(`Cached geocoding result for "${addressString}"`);
            } catch (cacheError) {
                // Log but don't fail if caching fails
                console.error(`Error caching geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
        }

        return coordinates;
    } catch (error) {
        console.error(`Error geocoding address "${addressString}":`, error instanceof Error ? error.message : String(error));
        return null;
    }
}

/**
 * Extracts event data from an event detail page HTML.
 * @param html The HTML content of the event detail page.
 * @param eventPageUrl The URL of the event detail page (for context and permalink).
 * @returns A ScrapedEvent object or null if essential data is missing.
 */
function extractEventDataFromDetailPage(html: string, eventPageUrl: string): ScrapedEvent | null {
    const $ = cheerio.load(html);

    const eventData: ScrapedEvent = {
        name: '',
        startAt: '',
        endAt: null,
        address: [],
        price: '',
        description: '',
        imageUrls: [],
        host: null,
        hostLink: null,
        permalink: makeAbsoluteUrl(eventPageUrl, BASE_URL) || eventPageUrl, // Fallback to pageUrl
        latitude: null,
        longitude: null,
        tags: [],
    };

    // Attempt to parse LD+JSON
    let ldJsonEventDataFound = false;
    $('script[type="application/ld+json"]').each((_i, el) => {
        try {
            const scriptContent = $(el).html();
            if (scriptContent) {
                const jsonData = JSON.parse(scriptContent);
                // Check if it's an array of event objects or a single event object
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                for (const item of eventsArray) {
                    if (item['@type'] === 'Event') {
                        eventData.name = item.name || eventData.name;
                        eventData.description = item.description || eventData.description; // Typically HTML
                        eventData.startAt = item.startDate || eventData.startAt;
                        eventData.endAt = item.endDate || eventData.endAt;
                        if (item.url) {
                            eventData.permalink = makeAbsoluteUrl(item.url, BASE_URL) || eventData.permalink;
                        }
                        // Potentially extract location, offers, organizer from LD+JSON if available
                        // For now, we prioritize what's in the example.
                        // Example: item.location might be an object with address details.
                        // item.offers might provide price.
                        // item.organizer might provide host info.
                        ldJsonEventDataFound = true;
                        // If multiple Event objects in LD+JSON, we take the first one.
                        // This script is designed to return one ScrapedEvent per detail page.
                        return false; // Break .each loop after finding the first Event
                    }
                }
            }
        } catch (e) {
            console.warn(`Error parsing LD+JSON on ${eventPageUrl}:`, e instanceof Error ? e.message : String(e));
        }
    });

    // HTML scraping for fallbacks or additional details
    if (!eventData.name) {
        eventData.name = $('h1.px-md-0').first().text().trim();
    }
    if (!eventData.description && !ldJsonEventDataFound) { // Only use HTML description if LD+JSON didn't provide one
        eventData.description = extractHtmlDescription($) || '';
    } else if (eventData.description && typeof eventData.description === 'string') {
        // Basic cleanup for description if it came from LD+JSON
        eventData.description = eventData.description.replace(/\n<p>\n<p>/g, '\n<p>').replace(/<p>\n<p>/g, '<p>');
    }


    const $table = $('.mod_eventreader .border.rounded-2.p-2 table').first();
    if ($table.length) {
        if (!eventData.price) { // Only if not found in LD+JSON offers
            const rawPrice = getTableCellValueByLabel($, $table, 'Kosten');
            if (rawPrice) {
                // Keep the entire price text, just trim whitespace
                eventData.price = rawPrice.trim();
            } else {
                eventData.price = '';
            }
        }

        const rawOrtHtml = getTableCellValueByLabel($, $table, 'Ort:', true);
        eventData.address = parseAddress(rawOrtHtml);

        const leitung = getTableCellValueByLabel($, $table, 'Leitung:');
        const anbieterRawHtml = getTableCellValueByLabel($, $table, 'Anbieter:in:', true);
        let hostFromAnbieter: string | null = null;
        let hostLinkFromAnbieter: string | null = null;

        if (anbieterRawHtml) {
            // Create a temporary document to parse the Anbieter:in HTML content
            const $anbieterContent = cheerio.load(`<div>${anbieterRawHtml}</div>`);

            // Get the first link which is typically the organization/provider link
            const providerLink = $anbieterContent('a').first();

            if (providerLink.length > 0) {
                // This is more complex than it seems - sometimes the name is in the link,
                // sometimes we should use Leitung instead
                const href = providerLink.attr('href');
                if (href && !href.startsWith('mailto:')) {
                    hostLinkFromAnbieter = href;

                    // Get the text from the link, which is typically the organization name
                    const linkText = providerLink.text().trim();
                    if (linkText) {
                        hostFromAnbieter = linkText;
                    }
                }
            }

            // If we couldn't extract a host from the Anbieter field, use Leitung as fallback
            if (!hostFromAnbieter && leitung) {
                hostFromAnbieter = leitung;
            }
        } else if (leitung) {
            // If no Anbieter:in field found at all, use Leitung as the host
            hostFromAnbieter = leitung;
        }

        eventData.host = hostFromAnbieter || null;
        const absoluteUrl = hostLinkFromAnbieter ? makeAbsoluteUrl(hostLinkFromAnbieter, BASE_URL) : null;
        eventData.hostLink = absoluteUrl || null;
    }

    // Image URLs - Extract images from the page content
    eventData.imageUrls = [];

    // First check for images in the LD+JSON (if we have LD+JSON data)
    $('script[type="application/ld+json"]').each((_i, el) => {
        try {
            const scriptContent = $(el).html();
            if (scriptContent) {
                const jsonData = JSON.parse(scriptContent);
                const eventsArray = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) ? jsonData['@graph'] : [jsonData];

                // Look for images in the JSON data
                for (const item of eventsArray) {
                    // Check for ImageObject types that might contain images
                    if (item['@type'] === 'ImageObject' && item.contentUrl) {
                        const imageUrl = makeAbsoluteUrl(item.contentUrl, BASE_URL);
                        if (imageUrl) {
                            eventData.imageUrls.push(imageUrl);
                        }
                    }

                    // Check Event objects for image properties
                    if (item['@type'] === 'Event') {
                        if (item.image) {
                            // Handle both string and object image formats
                            if (typeof item.image === 'string') {
                                const imageUrl = makeAbsoluteUrl(item.image, BASE_URL);
                                if (imageUrl) {
                                    eventData.imageUrls.push(imageUrl);
                                }
                            } else if (item.image.url) {
                                const imageUrl = makeAbsoluteUrl(item.image.url, BASE_URL);
                                if (imageUrl) {
                                    eventData.imageUrls.push(imageUrl);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Silently handle JSON parsing errors
            if (process.env.DEBUG) {
                console.error(`Error parsing JSON for image extraction: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    });

    // Then look for images in the HTML content
    $('.mod_eventreader .col-12.col-lg-7 img').each((_i, el) => {
        const src = $(el).attr('src');
        if (src) {
            const imageUrl = makeAbsoluteUrl(src, BASE_URL);
            if (imageUrl && !eventData.imageUrls.includes(imageUrl)) {
                eventData.imageUrls.push(imageUrl);
            }
        }
    });

    // If no images found yet, try a broader search
    if (eventData.imageUrls.length === 0) {
        $('.mod_eventreader img').each((_i, el) => {
            const src = $(el).attr('src');
            if (src) {
                const imageUrl = makeAbsoluteUrl(src, BASE_URL);
                if (imageUrl) {
                    eventData.imageUrls.push(imageUrl);
                }
            }
        });
    }

    // Tags - Extract categories or tags if available
    eventData.tags = [];


    if (!eventData.name || !eventData.startAt) {
        console.warn(`Skipping event from ${eventPageUrl} due to missing name or start date after parsing.`);
        return null;
    }

    return eventData;
}

/**
 * Extracts event data from an event detail page HTML.
 * @param html The HTML content of the event detail page.
 * @param eventPageUrl The URL of the event detail page (for context and permalink).
 * @returns A ScrapedEvent object or null if essential data is missing.
 */
async function extractEventDataFromDetailPageWithGeocoding(html: string, eventPageUrl: string): Promise<ScrapedEvent | null> {
    const eventData = extractEventDataFromDetailPage(html, eventPageUrl);
    if (!eventData) return null;

    // Geocode the address if we have address lines
    if (eventData.address.length > 0) {
        const coordinates = await geocodeAddressFromEvent(eventData.address);
        if (coordinates) {
            eventData.latitude = coordinates.lat;
            eventData.longitude = coordinates.lng;
        }
    }

    return eventData;
}

// --- Main Scraping Function ---
/**
 * Main function to scrape Heilnetz events.
 * Returns a promise that resolves to an array of ScrapedEvent objects.
 */
export async function scrapeHeilnetzEvents(): Promise<ScrapedEvent[]> {
    const startUrl = 'https://www.heilnetz.de/aktuelle-termine.html';
    const allEvents: ScrapedEvent[] = [];
    let totalPages = 1;

    console.error(`Fetching initial listing page: ${startUrl}...`);
    let firstPageHtml: string;
    try {
        firstPageHtml = await fetchHtml(startUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to fetch initial page ${startUrl}:`, message);
        // Depending on desired behavior, either exit or return empty array
        // For this script, exiting makes sense as it cannot proceed.
        if (typeof process !== 'undefined' && process.exit) process.exit(1); else throw error;
        return []; // Should not be reached if process.exit works
    }

    const $firstPage = cheerio.load(firstPageHtml);
    totalPages = getLastPageNumber($firstPage);
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
                        const currentPageHtml = await fetchHtml(pageUrl);
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
        const resultsFromOtherPages: string[][] = await Promise.all(pagePromises);
        resultsFromOtherPages.forEach(urlsFromPage => {
            urlsFromPage.forEach(url => eventDetailUrlSet.add(url));
        });
    }

    const eventDetailUrls = Array.from(eventDetailUrlSet);
    console.error(`Found ${eventDetailUrls.length} unique event detail URLs to process.`);

    // Now, fetch and process each event detail page sequentially
    for (const detailUrl of eventDetailUrls) {
        console.error(`Fetching and processing event detail page: ${detailUrl}...`);
        let eventHtml: string;
        try {
            eventHtml = await fetchHtml(detailUrl);
        } catch {
            console.error(`Skipping event detail page ${detailUrl} due to fetch error.`);
            continue;
        }

        const event = await extractEventDataFromDetailPageWithGeocoding(eventHtml, detailUrl);
        console.log(event);
        if (event) {
            // Handle cases where multiple dates on one page might imply multiple events (if permalink logic needs adjustment)
            // For now, assume one ScrapedEvent per detail page, LD+JSON start/end are primary.
            // The old permalink adjustment for multiple dates on the *same listing item* might not apply here
            // if each detail page represents one event or series.
            allEvents.push(event);
        }
    }

    console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
    return allEvents;
}

// --- Run Main --- Only when executed directly
if (import.meta.main) {
    // Bun uses process.argv. process.argv[0] is bun exe, process.argv[1] is script path.
    const filePathArg = process.argv[2];

    if (filePathArg) {
        // If a file path is provided, process that single file
        console.error(`Processing local HTML file: ${filePathArg}...`);
        Bun.file(filePathArg).text()
            .then(async htmlContent => {
                const event = await extractEventDataFromDetailPageWithGeocoding(htmlContent, filePathArg); // Use filePathArg as URL for permalink
                if (event) {
                    console.log(JSON.stringify(event, null, 2));
                    console.error(`--- Successfully processed ${filePathArg} ---`);
                } else {
                    console.error(`Could not extract event data from ${filePathArg}.`);
                    // Bun typically exits on unhandled promise rejection or error, but explicit exit can be used.
                    process.exit(1);
                }
            })
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Error processing file ${filePathArg}:`, message);
                process.exit(1);
            });
    } else {
        // Otherwise, run the full scraping process
        scrapeHeilnetzEvents()
            .then(events => {
                console.log(JSON.stringify(events, null, 2));
            })
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                console.error("Script execution failed:", message);
                process.exit(1);
            });
    }
}
