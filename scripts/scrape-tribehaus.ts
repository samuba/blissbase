/**
 * Fetches event pages from tribehaus.org (starting from https://tribehaus.org/events)
 * iterates through all pagination pages, and extracts all events as JSON according to the ScrapedEvent interface.
 * 
 * Requires Deno and the --allow-net permission.
 * Usage: deno run --allow-net scripts/scrape-tribehaus.ts > events.json
 */
import { ScrapedEvent } from "../src/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';

const BASE_URL = 'https://tribehaus.org';

// Helper to parse German date/time into ISO string
// Example inputs: "11.05.2025", "13:00 - 17:00"
function parseGermanDateTime(dateStr: string, timeStr: string | null): string | null {
    if (!dateStr || !/\d{2}\.\d{2}\.\d{4}/.test(dateStr)) {
        return null; // Invalid date format
    }
    const [day, month, year] = dateStr.split('.');
    let isoStr = `${year}-${month}-${day}`;

    if (timeStr) {
        const timeMatch = timeStr.match(/(\d{2}):(\d{2})/); // Match the start time (e.g., 13:00)
        if (timeMatch) {
            isoStr += `T${timeMatch[1]}:${timeMatch[2]}:00Z`; // Assume UTC for now
        } else {
            isoStr += `T00:00:00Z`; // Fallback if time format is unexpected
        }
    } else {
        isoStr += `T00:00:00Z`; // Default time if none specified
    }
    // Basic validation - could be improved with a date library
    try {
        new Date(isoStr).toISOString();
        return isoStr;
    } catch /* (e) */ {
        console.error(`Invalid date generated: ${isoStr} from ${dateStr} ${timeStr}`);
        return null;
    }
}

async function fetchPage(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error);
        throw error; // Re-throw to handle upstream
    }
}

// Parses a listing page to get event permalinks and the next page URL
function parseEventList(html: string): { permalinks: string[], nextPageUrl: string | null } {
    const $ = cheerio.load(html);
    const permalinks: string[] = [];
    let potentialNextPageUrl: string | null = null;

    // Extract permalinks from the search result items
    $('.sp11.jq-result-list-item').each((_index, element) => {
        const link = $(element).find('.sp150.jq-link-entry-page').attr('href');
        if (link) {
            permalinks.push(new URL(link, BASE_URL).toString());
        }
    });

    // Find next page link (using the selector from the example list page)
    const nextPageLink = $('.srp1 .page-next > a').attr('href');
    if (nextPageLink && nextPageLink !== '#') {
        potentialNextPageUrl = nextPageLink;
    }

    const nextPageUrl = potentialNextPageUrl ? new URL(potentialNextPageUrl, BASE_URL).toString() : null;

    return { permalinks, nextPageUrl };
}

// Fetches and parses a single event detail page
async function fetchAndParseEventDetail(permalink: string): Promise<ScrapedEvent | null> {
    try {
        const html = await fetchPage(permalink);
        const $ = cheerio.load(html);

        // --- Extract data using selectors from the detail page --- 

        const name = $('h1.ep121').text().trim() || 'N/A';

        // Address (more reliably from address block)
        const addressParts: string[] = [];
        $('.epl33 li').each((_, li) => {
            const strongText = $(li).find('strong').text().trim();
            const spanText = $(li).find('span:not([data-spec])').text().trim();
            const linkText = $(li).find('a').text().trim();
            const textToAdd = spanText || linkText;
            if (textToAdd && strongText !== 'Postleitzahl:') { // Avoid adding PLZ label
                addressParts.push(textToAdd);
            }
            if (strongText === 'Postleitzahl:' && linkText) { // Get PLZ from link text
                addressParts.push(linkText.replace('PLZ ', ''));
            }
        });
        // Add PLZ if found separately
        const plzLink = $('.epl33 li:contains("Postleitzahl:") a').text().trim().replace('PLZ ', '');
        if (plzLink && !addressParts.some(p => p === plzLink)) {
            addressParts.push(plzLink);
        }

        // Price (look in overview section first, then potentially JSON-LD)
        let price = 'Preis nicht angegeben';
        const priceElement = $('.ep95 li[data-property="Preis"] span').first();
        if (priceElement.length) {
            price = priceElement.text().trim();
        } else {
            // Fallback: Check JSON-LD priceRange if specific price not found
            const jsonLdScript = $('script[type="application/ld+json"]').html();
            if (jsonLdScript) {
                try {
                    const jsonData = JSON.parse(jsonLdScript);
                    if (jsonData.priceRange) {
                        price = jsonData.priceRange;
                    }
                } catch /*(e)*/ { /* ignore json parsing errors */ }
            }
        }

        const description = $('#description blockquote.readmore').text().trim() || '';

        // Images - Get all images from the main slider/gallery
        const imageUrls: string[] = [];
        $('.ep10 .cb-slider-inner .item img').each((_, img) => {
            const src = $(img).attr('src') || $(img).attr('srcset')?.split(' ')[0]; // Prefer src, fallback to srcset first entry
            if (src) {
                // Resolve relative URLs and remove query params if desired
                const fullUrl = new URL(src, BASE_URL).href.split('?')[0];
                if (!imageUrls.includes(fullUrl)) {
                    imageUrls.push(fullUrl);
                }
            }
        });
        // Also check secondary tiles
        $('.eph521:not(.eph521--map):not(.eph521--ratings) img').each((_, img) => {
            const src = $(img).attr('src') || $(img).attr('srcset')?.split(' ')[0];
            if (src) {
                const fullUrl = new URL(src, BASE_URL).href.split('?')[0];
                if (!imageUrls.includes(fullUrl)) {
                    imageUrls.push(fullUrl);
                }
            }
        });

        // Host info (from the specific section if available)
        let host: string | null = null;
        let hostLink: string | null = null;
        const memberLinkElement = $('li[data-property="Veranstalter"] .sp14 a.jq-link-entry-page');
        if (memberLinkElement.length) {
            host = memberLinkElement.text().trim();
            const link = memberLinkElement.attr('href');
            if (link) {
                hostLink = new URL(link, BASE_URL).toString();
            }
        } else {
            // Fallback: Check artist name if host not linked
            const artistElement = $('li[data-property="Knstlername"] span').first();
            if (artistElement.length) {
                host = artistElement.text().trim();
            }
        }

        // Location / Geo (from JSON-LD is easiest)
        let latitude: number | null = null;
        let longitude: number | null = null;
        const jsonLdScript = $('script[type="application/ld+json"]').html();
        if (jsonLdScript) {
            try {
                const jsonData = JSON.parse(jsonLdScript);
                if (jsonData.geo) {
                    latitude = parseFloat(jsonData.geo.latitude) || null;
                    longitude = parseFloat(jsonData.geo.longitude) || null;
                }
            } catch /*(e)*/ { /* ignore json parsing errors */ }
        }

        // Date and Time
        let startAt: string | null = null;
        let endAt: string | null = null;
        const dateElement = $('.ep3001112').first(); // Assuming first date is primary
        const timeElement = $('.ep3001113 span').first();
        if (dateElement.length) {
            const dateStr = dateElement.text().trim();
            const timeStr = timeElement.length ? timeElement.text().trim() : null;
            startAt = parseGermanDateTime(dateStr, timeStr);

            // Check for end date in range format "11.05.2025 bis 14.12.2025"
            const dateRangeMatch = dateStr.match(/(\d{2}\.\d{2}\.\d{4})\s*bis\s*(\d{2}\.\d{2}\.\d{4})/);
            if (dateRangeMatch) {
                startAt = parseGermanDateTime(dateRangeMatch[1], timeStr); // Use start date of range
                endAt = parseGermanDateTime(dateRangeMatch[2], null); // End date, assume end of day if time range isn't separate
            } else {
                // Check for end time in range format "13:00 - 17:00"
                const timeRangeMatch = timeStr?.match(/\d{2}:\d{2}\s*-\s*(\d{2}:\d{2})/);
                if (timeRangeMatch) {
                    // Construct end time using the *same* date but the end time part
                    const [day, month, year] = dateStr.split('.');
                    const isoDatePart = `${year}-${month}-${day}`;
                    endAt = `${isoDatePart}T${timeRangeMatch[1]}:00Z`; // Assume UTC
                    try { new Date(endAt).toISOString(); } catch /* (e) */ { endAt = null; }
                }
            }
        } else {
            // Fallback to JSON-LD date if primary element not found
            if (jsonLdScript) {
                try {
                    const jsonData = JSON.parse(jsonLdScript);
                    if (jsonData.startDate) startAt = parseGermanDateTime(jsonData.startDate.replace(/-/g, '.'), null); // JSON uses YYYY-MM-DD
                    if (jsonData.endDate) endAt = parseGermanDateTime(jsonData.endDate.replace(/-/g, '.'), null); // JSON uses YYYY-MM-DD
                } catch /*(e)*/ { /* ignore json parsing errors */ }
            }
        }

        // Tags / Categories
        const tags: string[] = [];
        $('li[data-property="Rubrik"] div.available').each((_, div) => {
            const tagText = $(div).text().trim();
            if (tagText) {
                tags.push(tagText);
            }
        });

        // Ensure startAt is not 'N/A'
        if (startAt === 'N/A') {
            console.error(`Invalid start date found for ${permalink}. Skipping event.`);
            return null;
        }

        return {
            name,
            startAt: startAt || 'N/A',
            endAt,
            address: addressParts.filter(part => part && part.trim() !== ''), // Clean empty parts
            price,
            description,
            imageUrls,
            host,
            hostLink,
            permalink,
            latitude,
            longitude,
            tags,
        };

    } catch (error) {
        console.error(`Failed to fetch or parse detail page ${permalink}:`, error);
        return null;
    }
}

/**
 * Main function to scrape Tribehaus events.
 * Returns a promise that resolves to an array of ScrapedEvent objects.
 */
export async function scrapeTribehausEvents(startUrl: string = `${BASE_URL}/events`): Promise<ScrapedEvent[]> {
    const allEvents: ScrapedEvent[] = [];
    let allPermalinks: string[] = [];
    let currentListUrl: string | null = startUrl;
    let pageCount = 1;

    // --- Step 1: Get all permalinks from listing pages ---
    console.error("--- Starting Phase 1: Collecting Permalinks ---");
    while (currentListUrl) {
        console.error(`Fetching list page ${pageCount}: ${currentListUrl}...`);
        try {
            const listHtml = await fetchPage(currentListUrl);
            const { permalinks, nextPageUrl } = parseEventList(listHtml);
            if (permalinks.length === 0 && pageCount > 1) {
                console.error(`No permalinks found on list page ${pageCount} (${currentListUrl}), stopping list pagination.`);
                currentListUrl = null;
            } else {
                allPermalinks = allPermalinks.concat(permalinks);
                currentListUrl = nextPageUrl;
                pageCount++;
                // Optional: Add delay between list page fetches
                // await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch (error) {
            console.error(`Error processing list page ${currentListUrl}:`, error);
            currentListUrl = null; // Stop if a list page fails
        }
    }
    console.error(`--- Finished Phase 1: Collected ${allPermalinks.length} permalinks ---`);

    // --- Step 2: Fetch and parse each detail page ---
    console.error("--- Starting Phase 2: Fetching Event Details ---");
    let detailCount = 0;
    for (const permalink of allPermalinks) {
        detailCount++;
        console.error(`Fetching detail ${detailCount}/${allPermalinks.length}: ${permalink}...`);
        const eventDetail = await fetchAndParseEventDetail(permalink);
        if (eventDetail) {
            allEvents.push(eventDetail);
        }
        // Optional: Add significant delay between detail page fetches to be very polite
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.error(`--- Finished Phase 2: Successfully parsed ${allEvents.length} events ---`);

    return allEvents;
}

// Main execution
if (import.meta.main) {
    const startUrl = `${BASE_URL}/events`;
    scrapeTribehausEvents(startUrl)
        .then(allEvents => {
            // Output JSON when run directly
            console.log(JSON.stringify(allEvents, null, 2));
        })
        .catch(error => {
            console.error("Scraping failed:", error);
            Deno.exit(1);
        });
}