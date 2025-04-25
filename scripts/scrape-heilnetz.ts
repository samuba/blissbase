/**
 * Fetches event pages from heilnetz.de (starting from https://heilnetz.de/aktuelle-termine.html)
 * iterates through all pagination pages, and extracts all events as JSON according to the HeilnetzEvent interface.
 * 
 * Requires Deno and the --allow-net permission.
 * Usage: deno run --allow-net scripts/scrape-heilnetz.ts > events.json
 */
import { ScrapedEvent } from "../src/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.heilnetz.de';


/**
 * Tries to make a URL absolute if it's relative (starts with /).
 * @param url The URL string.
 * @param baseUrl The base URL to prepend.
 * @returns Absolute URL or the original URL if it's already absolute or not a valid relative path.
 */
function makeAbsoluteUrl(url: string | undefined, baseUrl: string): string | undefined {
    if (!url) return url;

    if (url.startsWith('/')) {
        return baseUrl + url;
    }

    // Check if URL doesn't start with http:// or https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return baseUrl + '/' + url;
    }

    return url;
}

/**
 * Extracts text content following a specific <b> tag within a given context.
 * @param $ Cheerio static instance.
 * @param context Cheerio context (the element to search within).
 * @param labelText The text of the <b> tag (e.g., "Ort:", "Kosten:").
 * @returns The cleaned text content or null if not found.
 */
function getTextAfterLabel(
    $: cheerio.CheerioAPI,
    context: cheerio.Cheerio<cheerio.Element>,
    labelText: string
): string | null { // Returns raw HTML string now
    const labelElement = context.find(`b:contains("${labelText}")`);
    if (labelElement.length > 0) {
        let htmlContent = '';
        // Iterate over siblings following the <b> tag within its parent
        let nextNode = labelElement[0].nextSibling;
        while (nextNode) {
            // Stop if we encounter another <b> tag which likely starts a new section
            if (nextNode.type === 'tag' && nextNode.tagName.toLowerCase() === 'b') {
                break;
            }

            // Get the outer HTML of the node
            htmlContent += $(nextNode).prop('outerHTML') || $(nextNode).text();

            nextNode = nextNode.nextSibling;
        }

        // Basic trim
        const trimmedHtml = htmlContent.trim();

        // Return the raw HTML content, or null if empty
        return trimmedHtml.length > 0 ? trimmedHtml : null;
    }
    return null;
}


/**
 * Parses address details from the "Ort:" section.
 * @param fullLocationString Raw text from the "Ort:" section.
 * @returns An object with venue, street, postalCode, and city.
 */
function parseAddress(rawHtmlLocationString: string | null): string[] | null {
    if (!rawHtmlLocationString) return null;

    // Replace <br> tags with newlines
    const htmlWithNewlines = rawHtmlLocationString.replace(/<br\s*\/?>/gi, '\n');

    // Load into cheerio to strip remaining tags and get text
    const $temp = cheerio.load(`<div>${htmlWithNewlines}</div>`);
    const textContent = $temp.text();

    // Split by newlines, trim, and filter empty lines
    const lines = textContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    return lines.length > 0 ? lines : null;
}

/**
 * Extracts the host name from the header section.
 */
function getHostFromHeader($: cheerio.CheerioAPI, header: cheerio.Cheerio<cheerio.Element>): string | null {
    const personIcon = header.find('i.bi-person');
    if (personIcon.length > 0) {
        let hostText = '';
        let nextNode = personIcon[0].nextSibling;
        while (nextNode && nextNode.type === 'text') {
            hostText += $(nextNode).text();
            nextNode = nextNode.nextSibling;
        }
        return hostText.trim() || null;
    }
    return null;
}

/**
 * Extracts the time range from the header section.
 */
function getTimeFromHeader($: cheerio.CheerioAPI, header: cheerio.Cheerio<cheerio.Element>): string | null {
    const clockIcon = header.find('i.bi-clock');
    if (clockIcon.length > 0) {
        let timeText = '';
        let nextNode = clockIcon[0].nextSibling;
        // Capture text nodes until the next <br> or end
        while (nextNode && (nextNode.type === 'text' || (nextNode.type === 'tag' && nextNode.tagName !== 'br'))) {
            timeText += $(nextNode).text();
            nextNode = nextNode.nextSibling;
        }
        return timeText.trim() || null;
    }
    return null;
}

/**
 * Extracts and cleans the event description HTML.
 */
function getDescription($: cheerio.CheerioAPI, detailBody: cheerio.Cheerio<cheerio.Element>): string | null {
    const descriptionContainer = detailBody.find('.col.px-0'); // Second column usually
    if (!descriptionContainer.length) return null;

    let descriptionHtml = '';
    descriptionContainer.children().each((_i, el) => {
        const $el = $(el);
        // Stop if we hit the "Weitere Termine" or "Permalink" sections
        if ($el.text().includes('Weitere Termine:') || $el.find('a.small').length > 0) {
            return false; // Stop .each loop
        }
        // Get outer HTML of the element
        descriptionHtml += $.html($el)?.trim() + '\n';
    });

    return descriptionHtml.trim() || null;
}

/**
 * Extracts other dates.
 */
/* // Removed - not needed for ScrapedEvent
function getOtherDates($: cheerio.CheerioAPI, detailBody: cheerio.Cheerio<cheerio.Element>): string[] | null {
    const datesParagraph = detailBody.find('p:contains("Weitere Termine:")');
    if (datesParagraph.length > 0) {
        // Get HTML, replace <br> with newline, then extract text and split
        const htmlContent = datesParagraph.html();
        if (htmlContent) {
            const textContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');
            const $temp = cheerio.load(`<div>${textContent}</div>`); // Load into temp cheerio to easily get text
            const lines = $temp.text().split('\n');
            const dates = lines
                .map(line => line.trim())
                .filter(line => line && line !== 'Weitere Termine:'); // Filter out empty lines and the label
            return dates.length > 0 ? dates : null;
        }
    }
    return null;
}
*/

/**
 * Parses date and time strings into ISO 8601 format.
 * @param dateStr Date string (e.g., "2025-05-11T00:00:00+02:00")
 * @param timeStr Time string (e.g., "10:00 - 17:30" or "19:00")
 * @returns Object with startAt and endAt ISO strings, or empty strings if parsing fails.
 */
function parseDateTimeRange(dateStr: string | null, timeStr: string | null): { startAt: string, endAt: string } {
    const result = { startAt: '', endAt: '' };
    if (!dateStr) return result;

    try {
        // Extract date part (YYYY-MM-DD) and timezone offset
        const datePart = dateStr.substring(0, 10);
        const timezoneOffset = dateStr.substring(19); // e.g., +02:00 or Z

        let startTime = '00:00:00';
        let endTime = ''; // Initially unknown

        if (timeStr) {
            const timeMatch = timeStr.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/); // Matches "HH:MM - HH:MM"
            const singleTimeMatch = timeStr.match(/^(\d{1,2}:\d{2})$/); // Matches "HH:MM"

            if (timeMatch) {
                startTime = timeMatch[1].padStart(5, '0') + ':00'; // Ensure HH:MM format
                endTime = timeMatch[2].padStart(5, '0') + ':00';   // Ensure HH:MM format
            } else if (singleTimeMatch) {
                startTime = singleTimeMatch[1].padStart(5, '0') + ':00';
                // If only start time, set end time equal to start time for now
                // Duration field could override this later if implemented
                endTime = startTime;
            }
            // If timeStr exists but doesn't match known formats, startTime remains '00:00:00'
        } else {
            // If no time string, check if dateStr contains a non-zero time
            const timeFromDate = dateStr.substring(11, 19);
            if (timeFromDate && timeFromDate !== '00:00:00') {
                startTime = timeFromDate;
                endTime = startTime; // Set end=start if time comes from dateStr
            } else {
                // If dateStr is T00:00:00 and no timeStr, we cannot determine time. Return empty.
                // console.warn(`Missing time for date: ${dateStr}`);
                return { startAt: '', endAt: '' };
            }
        }

        result.startAt = `${datePart}T${startTime}${timezoneOffset}`;
        result.endAt = `${datePart}T${endTime}${timezoneOffset}`; // Assume same day for now

        // Basic validation
        if (isNaN(new Date(result.startAt).getTime())) {
            console.warn(`Invalid start date generated: ${result.startAt} from ${dateStr}, ${timeStr}`);
            result.startAt = '';
        }
        if (isNaN(new Date(result.endAt).getTime())) {
            console.warn(`Invalid end date generated: ${result.endAt} from ${dateStr}, ${timeStr}`);
            result.endAt = '';
        }


    } catch (e) {
        console.error("Error parsing date/time:", dateStr, timeStr, e);
        return { startAt: '', endAt: '' };
    }
    return result;
}

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
        throw error; // Re-throw the error to stop the script if fetching fails
    }
}

/**
 * Extracts the last page number from the pagination block.
 * @param $ Cheerio instance loaded with the HTML of a page containing pagination.
 * @returns The last page number, or 1 if pagination is not found.
 */
function getLastPageNumber($: cheerio.CheerioAPI): number {
    const paginationEndLink = $('nav[aria-label="Pagination"] a[aria-label="Ende"]');
    if (paginationEndLink.length > 0) {
        const href = paginationEndLink.attr('href');
        if (href) {
            const match = href.match(/page_e2=(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
        }
        // Fallback: try finding the last numbered page link if "Ende" link has no number
        const lastPageLink = $('nav[aria-label="Pagination"] .page-item:not(.d-none) a.page-link').last().prev();
        const lastPageText = lastPageLink.text().trim();
        const lastPageNum = parseInt(lastPageText, 10);
        if (!isNaN(lastPageNum)) {
            return lastPageNum;
        }

    }
    console.warn("Could not determine last page number from pagination. Assuming only one page.");
    return 1; // Default to 1 if pagination or last page number isn't found
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

    console.error(`Fetching page 1: ${startUrl}...`);
    let firstPageHtml: string;
    try {
        firstPageHtml = await fetchHtml(startUrl);
    } catch (error) {
        // Explicitly handle error type
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to fetch initial page ${startUrl}:`, message);
        process.exit(1);
    }

    // Determine total number of pages
    const $firstPage = cheerio.load(firstPageHtml);
    totalPages = getLastPageNumber($firstPage);
    console.error(`Found ${totalPages} total pages.`);

    // Process page 1
    console.error("Processing page 1...");
    processPage($firstPage, allEvents);

    // Loop through remaining pages
    for (let i = 2; i <= totalPages; i++) {
        const pageUrl = `${startUrl}?page_e2=${i}`;
        console.error(`Fetching page ${i}: ${pageUrl}...`);
        let currentPageHtml: string;
        try {
            currentPageHtml = await fetchHtml(pageUrl);
        } catch {
            console.error(`Skipping page ${i} due to fetch error.`);
            continue; // Skip to the next page if fetch fails
        }
        console.error(`Processing page ${i}...`);
        const $currentPage = cheerio.load(currentPageHtml);
        processPage($currentPage, allEvents);
    }

    // 5. Output the result as JSON - REMOVED
    // console.log(JSON.stringify(allEvents, null, 2));
    console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
    return allEvents; // Return the collected events
}

/**
 * Processes a single page of HTML to extract events and add them to the results array.
 * @param $ Cheerio instance loaded with the page HTML.
 * @param allEvents Array to append extracted events to.
 */
function processPage($: cheerio.CheerioAPI, allEvents: ScrapedEvent[]) {
    $('.accordion-item').each((_index, element) => {
        const $item = $(element);
        const $header = $item.find('.accordion-header > div'); // Container for header info
        const $detailBody = $item.find('.accordion-body');
        const $detailCol1 = $detailBody.find('.col-12.col-md-3'); // Left column in detail view
        // const $detailCol2 = $detailBody.find('.col.px-0'); // Right column (description) in detail view

        // Initialize with default values matching the interface
        const eventData: ScrapedEvent = {
            name: '',
            startAt: '',
            endAt: null, // Initialize endAt as null
            address: [], // Changed to array
            price: '',
            description: '',
            imageUrls: [], // Initialize as empty array
            host: null, // Initialize as null
            hostLink: null, // Initialize as null
            permalink: '',
            latitude: null, // Initialize as null
            longitude: null, // Initialize as null
            tags: [], // Initialize as empty array
        };

        // --- Extract Raw Data (using nullable types initially) ---
        const rawName = $header.find('.text-hn-termine').text().trim() || null;
        const rawDate = $header.find('time').attr('datetime') || null;
        const rawHostHeader = getHostFromHeader($, $header);
        const rawTime = getTimeFromHeader($, $header);
        const imageUrlRelative = $detailCol1.find('figure img').attr('src');
        const fullLocationString = getTextAfterLabel($, $detailCol1, 'Ort:');
        const rawPrice = getTextAfterLabel($, $detailCol1, 'Kosten:');
        const hostLinkElement = $detailCol1.find('b:contains("Anbieter:in")').parent().find('a');
        const rawHostDetailName = hostLinkElement.text().trim() || null;
        const hostProfileUrlRelative = hostLinkElement.attr('href');
        const rawDescription = getDescription($, $detailBody);
        const permalinkElement = $detailBody.find('a.small');
        const permalinkRelative = permalinkElement.attr('href');
        const rawTags = $detailBody.find('.badge').map((_, el) => $(el).text().trim()).get();


        // --- Process and Assign to eventData (following HeilnetzEvent structure) ---

        eventData.name = rawName ?? '';

        // Parse Start/End Times
        const { startAt, endAt } = parseDateTimeRange(rawDate, rawTime);
        eventData.startAt = startAt;
        eventData.endAt = endAt;

        // Parse Address and Venue
        const addressLines = parseAddress(fullLocationString);
        eventData.address = addressLines ?? [];

        eventData.price = rawPrice ?? '';
        eventData.description = rawDescription ?? ''; // Keep HTML as returned by getDescription
        const imageUrl = makeAbsoluteUrl(imageUrlRelative, BASE_URL);
        eventData.imageUrls = imageUrl ? [imageUrl] : []; // Assign as an array
        // Prefer host name from details if available, otherwise use header host name
        eventData.host = rawHostDetailName ?? rawHostHeader ?? null; // Use null if neither found
        eventData.hostLink = makeAbsoluteUrl(hostProfileUrlRelative, BASE_URL) ?? null; // Use null if not found
        eventData.permalink = makeAbsoluteUrl(permalinkRelative, BASE_URL) ?? '';
        eventData.latitude = null; // Initialize as null
        eventData.longitude = null; // Initialize as null
        eventData.tags = rawTags ?? []; // Assign extracted tags

        // No intermediate fields like hostHeader, hostDetails, locationDetails, locationShort, duration, extras needed in final object.

        // Only push if essential data is present (e.g., name and startAt)
        if (eventData.name && eventData.startAt) {
            // Check if an event with the same permalink already exists
            const existingEventIndex = allEvents.findIndex(event => event.permalink === eventData.permalink);

            if (existingEventIndex !== -1 && eventData.permalink) {
                // Extract the date part from startAt (YYYY-MM-DD)
                const datePart = eventData.startAt.substring(0, 10);
                // Append the date to the permalink with a #
                eventData.permalink = `${eventData.permalink}#${datePart}`;
            }

            allEvents.push(eventData);
        } else {
            console.warn('Skipping event due to missing name or start date', { name: eventData.name, start: eventData.startAt, permalink: eventData.permalink });
        }
    }); // End of .each loop
}

// --- Run Main --- Only when executed directly
if (import.meta.main) {
    scrapeHeilnetzEvents()
        .then(events => {
            // Output JSON when run directly
            console.log(JSON.stringify(events, null, 2));
        })
        .catch(error => {
            // Explicitly handle error type
            const message = error instanceof Error ? error.message : String(error);
            console.error("Script execution failed:", message);
            process.exit(1);
        });
}
