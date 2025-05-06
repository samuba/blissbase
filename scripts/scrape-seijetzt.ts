import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';

const BASE_URL = "https://sei.jetzt";
const START_PATH = "/"; // Main page seems to list events
const REQUEST_DELAY_MS = 600; // Be polite with requests
const USER_AGENT = 'Mozilla/5.0 (compatible; ConsciousPlacesBot/1.0; +https://conscious.place)';

// --- Helper Functions ---

async function Bun.sleep(ms: number): Promise < void> {
    return Bun.sleep(ms);
}

async function fetchPage(url: string): Promise<{ html: string | null, redirected: boolean }> {
    try {
        console.error(`Fetching: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT
            },
            redirect: 'manual' // Important: Don't follow redirects automatically
        });
        await Bun.sleep(REQUEST_DELAY_MS / 2); // Small delay even after response starts

        // Check for redirect status codes (3xx)
        if (response.status >= 300 && response.status < 400) {
            console.error(`Redirect detected fetching ${url}. Status: ${response.status}. Assuming end of pages.`);
            return { html: null, redirected: true };
        }

        if (!response.ok) {
            console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
            try {
                const errorBody = await response.text();
                console.error(`Error body: ${errorBody.slice(0, 500)}...`);
            } catch { /* ignore read error */ }
            return { html: null, redirected: false }; // Not a redirect, but an error
        }
        return { html: await response.text(), redirected: false };
    } catch (error) {
        console.error(`Network error fetching ${url}:`, error);
        return { html: null, redirected: false }; // Network error
    }
}

/**
 * Attempts to parse German date/time strings into ISO 8601 format.
 * Handles formats like: DD.MM.YYYY, DD.MM.YYYY HH:mm
 * Returns YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (local time implied)
 */
function parseGermanDate(dateStr: string): string | null {
    if (!dateStr) return null;
    dateStr = dateStr.trim();

    const dateTimeRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(\d{1,2}):(\d{2})/;
    const dateRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

    let match = dateStr.match(dateTimeRegex);
    if (match) {
        const [, day, month, year, hour, minute] = match;
        const parsedMonth = parseInt(month);
        const parsedDay = parseInt(day);
        const parsedYear = parseInt(year);
        const parsedHour = parseInt(hour);
        const parsedMinute = parseInt(minute);

        if (parsedMonth > 0 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 && parsedYear > 1900 && parsedHour >= 0 && parsedHour < 24 && parsedMinute >= 0 && parsedMinute < 60) {
            return `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(parsedDay).padStart(2, '0')}T${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}:00`;
        }
    }

    match = dateStr.match(dateRegex);
    if (match) {
        const [, day, month, year] = match;
        const parsedMonth = parseInt(month);
        const parsedDay = parseInt(day);
        const parsedYear = parseInt(year);

        if (parsedMonth > 0 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 && parsedYear > 1900) {
            return `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(parsedDay).padStart(2, '0')}`;
        }
    }

    console.error(`Could not parse date: "${dateStr}"`);
    return null;
}

/**
 * Parses date/time range from sei.jetzt list view format.
 */
function parseSeiJetztDateTimeRange(startStr: string, endStrRaw: string | null): { startAt: string | null, endAt: string | null } {
    const startAt: string | null = parseGermanDate(startStr);
    let endAt: string | null = null;

    if (endStrRaw && endStrRaw.startsWith('- ')) {
        const endStr = endStrRaw.substring(2).trim(); // Remove '- '

        // Case 1: Only time provided (e.g., "- 19:00") -> Assume same day as start
        if (startAt && /^\d{1,2}:\d{2}$/.test(endStr)) {
            const startDatePart = startAt.split('T')[0]; // Get YYYY-MM-DD
            if (startDatePart && startDatePart.includes('-')) {
                const [year, month, day] = startDatePart.split('-');
                const endDateForParse = `${day}.${month}.${year} ${endStr}`;
                endAt = parseGermanDate(endDateForParse);
            }
        }
        // Case 2: Full date/time provided (e.g., "- 27.04.2025 14:00")
        else {
            endAt = parseGermanDate(endStr);
        }
    }

    return { startAt, endAt };
}

/**
 * Parses address string from tooltip or detail page <dd>.
 */
function parseAddressLines(addressStr: string | undefined): string[] {
    if (!addressStr) return [];
    console.error(`Parsing address HTML: ${addressStr.substring(0, 150)}...`);
    // Example: 'Ginsterweg 3, 31595 Steyerberg'
    // Example: 'Liebigstraße 25, 49074 Osnabrück'
    // Example from detail: 'Aikido Schule<br>Liebigstraße 25<br>49074 Osnabrück'
    addressStr = addressStr.replace(/<br\s*\/?>/gi, ','); // Replace <br> with comma for splitting
    const lines = addressStr.split(',').map(part => part.trim()).filter(part =>
        part.length > 0 &&
        !part.toLowerCase().includes('karte anzeigen') &&
        !part.toLowerCase().includes('google map')
    );
    console.error(`Address lines extracted: ${JSON.stringify(lines)}`);
    return lines;
}

/**
 * Extracts partial event data from the HTML list page.
 * Currently only processes the first page due to pagination complexity.
 */
async function parseListPage(html: string): Promise<Partial<ScrapedEvent>[]> {
    const $ = cheerio.load(html);
    const events: Partial<ScrapedEvent>[] = [];
    // The grid contains the event cards
    const eventCards = $('div.fi-ta-record');

    console.error(`Found ${eventCards.length} event cards on the page.`);

    eventCards.each((_index, element) => {
        const $card = $(element);
        const $link = $card.find('a[href^="https://sei.jetzt/event/"]').first(); // Link to detail page

        const permalink = $link.attr('href');
        const name = $link.find('span.text-lg.font-bold').first().text().trim(); // Event title

        // Extract date/time strings
        const dateTimeSpans = $link.find('span.text-base.font-bold');
        const startStr = dateTimeSpans.eq(0).text().trim();
        const endStrRaw = dateTimeSpans.length > 1 ? dateTimeSpans.eq(1).text().trim() : null;

        // Host/Organizer from list card
        const host = $link.find('span.text-lg.font-bold').closest('.fi-ta-col-wrp').next().find('span.text-sm').first().text().trim();

        // Image from list card
        const $img = $link.find('img[srcset]');
        let previewImageUrl: string | null = null;
        if ($img.length > 0) {
            const srcset = $img.attr('srcset');
            if (srcset) {
                const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
                if (sources.length > 0) {
                    try {
                        const potentialUrl = sources[sources.length - 1];
                        // Simple check for base64 or placeholder images
                        if (!potentialUrl.startsWith('data:') && !potentialUrl.includes('placeholder')) {
                            previewImageUrl = new URL(potentialUrl, BASE_URL).toString();
                        }
                    } catch { /* ignore invalid URL */ }
                }
            }
            if (!previewImageUrl && $img.attr('src')) {
                try {
                    const srcUrl = $img.attr('src');
                    if (srcUrl && !srcUrl.startsWith('data:') && !srcUrl.includes('placeholder')) {
                        previewImageUrl = new URL(srcUrl, BASE_URL).toString();
                    }
                } catch { /* ignore invalid URL */ }
            }
        }

        // Location Name and Address (from tooltip)
        let locationName: string | null = null;
        let address: string[] = [];
        const locationIcon = $link.find('svg path[d^="m11.54"]'); // Find location icon
        if (locationIcon.length > 0) {
            const locationNameWrapper = locationIcon.closest('.fi-ta-col-wrp')?.next(); // Next div likely holds name/tooltip
            if (locationNameWrapper) {
                locationName = locationNameWrapper.find('span.text-sm').first().text().trim();
                const tooltipWrapper = locationNameWrapper.find('.fi-ta-col-wrp[x-tooltip]'); // The specific div with the tooltip
                const tooltipAttr = tooltipWrapper.attr('x-tooltip');
                if (tooltipAttr) {
                    const match = tooltipAttr.match(/content:\s*'([^']*)'/);
                    if (match && match[1]) {
                        address = parseAddressLines(match[1]);
                    }
                }
                // If tooltip parsing failed but we have a name, use it as address line
                if (address.length === 0 && locationName) {
                    address = [locationName];
                }
            }
        }

        if (!permalink || !name || !startStr) {
            console.error("Skipping event card due to missing permalink, name, or start date string.");
            return;
        }

        const { startAt, endAt } = parseSeiJetztDateTimeRange(startStr, endStrRaw);

        if (!startAt) {
            console.error(`Skipping event "${name}" due to failed date parsing for start: "${startStr}"`);
            return;
        }

        const partialEvent: Partial<ScrapedEvent> = {
            permalink,
            name,
            startAt,
            endAt,
            address,
            host,
            hostLink: null, // Not on list page
            imageUrls: previewImageUrl ? [previewImageUrl] : [],
            price: null,
            description: null,
            latitude: null,
            longitude: null,
            tags: [],
        };
        events.push(partialEvent);
    });

    console.error(`Parsed ${events.length} partial events from the list page.`);
    return events;
}

/**
 * Fetches and parses the detail page for an event, adding missing details.
 */
async function fetchEventDetails(event: Partial<ScrapedEvent>): Promise<ScrapedEvent> {
    // Ensure essential data from list view is present
    if (!event.name || !event.permalink || !event.startAt) {
        console.error("Cannot fetch details for event with missing name, permalink, or startAt:", event.permalink);
        // Return a partially filled event to avoid crashing downstream
        return {
            name: event.name ?? 'Unknown Event (Incomplete Data)',
            startAt: event.startAt ?? new Date().toISOString(),
            endAt: event.endAt ?? null,
            address: event.address ?? [],
            price: event.price ?? null,
            description: event.description ?? 'Error retrieving details.',
            imageUrls: event.imageUrls ?? [],
            host: event.host ?? null,
            hostLink: event.hostLink ?? null,
            permalink: event.permalink ?? '',
            latitude: event.latitude ?? null,
            longitude: event.longitude ?? null,
            tags: event.tags ?? [],
        };
    }

    const completedEvent: ScrapedEvent = {
        name: event.name,
        startAt: event.startAt,
        endAt: event.endAt ?? null,
        address: event.address ?? [],
        price: event.price ?? null,
        description: event.description ?? null,
        imageUrls: event.imageUrls ?? [],
        host: event.host ?? null,
        hostLink: event.hostLink ?? null,
        permalink: event.permalink,
        latitude: event.latitude ?? null,
        longitude: event.longitude ?? null,
        tags: event.tags ?? [],
    };

    await Bun.sleep(REQUEST_DELAY_MS);
    const detailHtml = await fetchPage(completedEvent.permalink);

    if (!detailHtml.html) {
        console.error(`Failed to fetch details for: ${completedEvent.permalink}`);
        completedEvent.description = completedEvent.description ?? 'Failed to fetch event details.';
        return completedEvent; // Return the partially filled event
    }

    try {
        const $ = cheerio.load(detailHtml.html);

        // --- Extract Detail Page Fields ---

        // Definition List <dl> holds many key details
        const $dl = $('dl.fi-description-list').first(); // Adjust if multiple <dl> exist

        if ($dl.length > 0) {
            // Refine Date/Time if possible (sometimes detail page has more precision)
            const dateDt = $dl.find('dt:contains("Datum")').first();
            if (dateDt.length > 0) {
                const dateDdText = dateDt.next('dd').text().trim();
                // Example: "Samstag, 26. April 2025 14:00 - Sonntag, 27. April 2025 14:00"
                // Attempt to re-parse if format differs or adds more detail
                // Simple approach: Split by ' - ', parse start and end
                const parts = dateDdText.split(' - ');
                if (parts.length > 0) {
                    // Remove day name like "Samstag, " before parsing
                    const cleanStartStr = parts[0].replace(/^\w+,\s*/, '').trim();
                    const newStartAt = parseGermanDate(cleanStartStr);
                    if (newStartAt) completedEvent.startAt = newStartAt; // Update only if parsing successful

                    if (parts.length > 1) {
                        const cleanEndStr = parts[1].replace(/^\w+,\s*/, '').trim();
                        const newEndAt = parseGermanDate(cleanEndStr);
                        completedEvent.endAt = newEndAt; // Update or set end date
                    }
                }
            }

            // Try a direct, hardcoded approach using the exact structure seen in the example HTML
            console.error(`Trying direct HTML match approach for ${completedEvent.permalink}`);
            let addressFound = false;

            // Look for specific structure: div.font-bold with text "Veranstaltungsort" followed by
            // div.flex containing the address with <br> tags
            const directLocationHTML = $('body').html();
            if (directLocationHTML) {
                // Use regex to directly extract what's between the relevant elements
                // This regex captures content between "Veranstaltungsort" and the Google Maps link
                const addressRegex = /Veranstaltungsort[\s\S]*?<\/div>\s*<div[^>]*>\s*<div>\s*(?:<a[^>]*>(.*?)<\/a>\s*)?<br>\s*([\s\S]*?)<a[^>]*>Auf Google Maps suchen<\/a>/i;
                const matches = directLocationHTML.match(addressRegex);

                if (matches && matches.length >= 3) {
                    console.error(`Direct regex matched! Found location name: '${matches[1] || ''}'`);

                    let addressText = matches[1] ? matches[1] + ', ' : '';
                    addressText += matches[2] || '';

                    // Clean up the address text, replace <br> with commas
                    addressText = addressText.replace(/<br\s*\/?>/gi, ', ');

                    // Extract clean lines
                    const addressLines = addressText.split(',')
                        .map(line => line.trim())
                        .filter(line => line.length > 0 && !line.toLowerCase().includes('karte') && !line.toLowerCase().includes('google'));

                    if (addressLines.length > 0) {
                        completedEvent.address = addressLines;
                        console.error(`Successfully extracted address via direct HTML match: ${addressLines.join(', ')}`);
                        addressFound = true;
                    } else {
                        console.warn(`Direct regex matched but no valid address lines extracted for ${completedEvent.permalink}`);
                    }
                } else {
                    console.warn(`Direct regex match failed for ${completedEvent.permalink}`);
                }
            }

            // If direct match failed, look for "Veranstaltungsort" or "Ort" more generically
            if (!addressFound) {
                // Location / Address (Detail page often has more structure)
                // First look for the div with svg icon that contains this text
                console.error(`Looking for address using DOM selectors for ${completedEvent.permalink}`);
                const veranstaltungsortText = $('div:contains("Veranstaltungsort")').filter(function () {
                    return $(this).text().trim() === 'Veranstaltungsort' ||
                        $(this).text().trim().includes('Veranstaltungsort');
                });

                console.error(`Found ${veranstaltungsortText.length} elements with "Veranstaltungsort" text`);

                if (veranstaltungsortText.length > 0) {
                    // Get the next sibling
                    const nextElement = veranstaltungsortText.next();
                    console.error(`Next element exists: ${nextElement.length > 0}`);

                    if (nextElement.length > 0) {
                        // Extract the HTML
                        const addressHTML = nextElement.html();

                        if (addressHTML) {
                            const addressLines = parseAddressLines(addressHTML);
                            if (addressLines.length > 0) {
                                completedEvent.address = addressLines;
                                console.error(`Successfully extracted address from next element: ${addressLines.join(', ')}`);
                                addressFound = true;
                            }
                        }
                    }
                }
            }

            // If address is still not found, let's try to extract anything that looks like a German address
            if (!addressFound && completedEvent.address.length === 0) {
                console.error(`Trying last-resort generic address pattern matching for ${completedEvent.permalink}`);
                // Look for patterns like "Street Name ##, ##### City"
                const bodyText = $('body').text();
                // German address regex - match patterns like "Straße 123, 12345 Stadt"
                const germanAddressRegex = /([A-Za-zäöüÄÖÜß\s.-]+\s\d+,\s\d{5}\s[A-Za-zäöüÄÖÜß\s.-]+)/g;
                const potentialAddresses = bodyText.match(germanAddressRegex);

                if (potentialAddresses && potentialAddresses.length > 0) {
                    console.error(`Found ${potentialAddresses.length} potential address patterns in page text`);
                    // Take the first good match
                    const addressLines = potentialAddresses[0].split(',').map(part => part.trim());
                    completedEvent.address = addressLines;
                    console.error(`Last resort address found: ${addressLines.join(', ')}`);
                }
            }

            // Price
            const preisDt = $dl.find('dt:contains("Preis"), dt:contains("Kosten")').first();
            if (preisDt.length > 0) {
                let priceText = preisDt.next('dd').text().trim();
                // Basic check if it looks like a price or "Kostenlos" etc.
                if (priceText) {
                    // Remove details like "(zzgl. Gebühren)" if needed
                    priceText = priceText.replace(/\(.*?\)/g, '').trim();
                    if (priceText.toLowerCase().includes("kostenlos") || priceText.toLowerCase().includes("frei")) {
                        completedEvent.price = "Free";
                    } else if (/\d/.test(priceText)) { // Check if it contains a digit
                        completedEvent.price = priceText;
                    }
                }
            }

            // Categories / Tags
            const kategorienDt = $dl.find('dt:contains("Kategorien")').first();
            const tagsSet = new Set<string>(completedEvent.tags); // Use Set for uniqueness
            if (kategorienDt.length > 0) {
                kategorienDt.next('dd').find('span a, span').each((_i, el) => { // Get text from link or span
                    const tagText = $(el).text().trim();
                    if (tagText) tagsSet.add(tagText);
                });
            }
            completedEvent.tags = Array.from(tagsSet);

            // Host / Organizer Link
            const veranstalterDt = $dl.find('dt:contains("Veranstalter")').first();
            if (veranstalterDt.length > 0) {
                const hostLinkElement = veranstalterDt.next('dd').find('a').first();
                if (hostLinkElement.length > 0) {
                    completedEvent.host = hostLinkElement.text().trim(); // Update host name from link text
                    const hostLink = hostLinkElement.attr('href');
                    if (hostLink) {
                        try {
                            completedEvent.hostLink = new URL(hostLink, BASE_URL).toString();
                        } catch {
                            console.error(`Invalid host link URL found on detail page: ${hostLink}`);
                            completedEvent.hostLink = null;
                        }
                    }
                } else {
                    // Fallback if host is not linked
                    completedEvent.host = veranstalterDt.next('dd').text().trim();
                }
            }

            // Final fallback: Try looking for "Ort" in a dl/dt structure
            if (!addressFound) {
                console.error(`Trying final fallback to 'Ort' in dl/dt structure for ${completedEvent.permalink}`);
                const ortDt = $dl.find('dt:contains("Ort")').first();
                if (ortDt.length > 0) {
                    const ortDd = ortDt.next('dd');
                    if (ortDd.length > 0) {
                        const addressHtml = ortDd.html();
                        if (addressHtml) {
                            const detailedAddress = parseAddressLines(addressHtml);
                            if (detailedAddress.length > 0) {
                                completedEvent.address = detailedAddress;
                                console.error(`Successfully extracted address (fallback DL): ${detailedAddress.join(', ')}`);
                                addressFound = true;
                            }
                        }
                    }
                }
            }
        }

        // Description (Look in common content containers)
        let description: string | null = null;
        const potentialDescSelectors = [
            '.prose', // Often used for markdown-rendered content
            '.entry-content', // WordPress standard
            'article', // Semantic tag
            '.event-description', // Generic
            '.fi-section-content', // Filament UI pattern might wrap content
        ];

        for (const selector of potentialDescSelectors) {
            const element = $(selector).first();
            if (element.length > 0) {
                // Check if it's likely the main description (avoid grabbing sidebars etc.)
                if (element.closest('aside, .sidebar').length === 0) {
                    // Convert HTML to text using a simpler approach
                    const descriptionText = element.text().trim().replace(/\s+/g, ' ');
                    if (descriptionText && descriptionText.length > 50) { // Basic check for substantial content
                        description = descriptionText;
                        console.error(`Description found using selector: ${selector}`);
                        break;
                    } else {
                        description = null; // Reset if too short/likely noise
                    }
                }
            }
        }
        completedEvent.description = description || completedEvent.description; // Keep list description if detail fails


        // Image URLs (Collect from main content, avoiding duplicates)
        const imageUrlsSet = new Set<string>(completedEvent.imageUrls);
        const contentAreaSelector = '.prose, .entry-content, article'; // Focus search area
        $(contentAreaSelector).find('img').each((_i, img) => {
            const $img = $(img);
            let src = $img.attr('src');
            if (!src) src = $img.attr('data-src') || $img.attr('data-lazy-src'); // Handle lazy loading

            if (src && !src.startsWith('data:') && !src.includes('avatar') && !src.includes('icon') && !src.includes('placeholder')) {
                try {
                    const absoluteUrl = new URL(src, BASE_URL).toString();
                    imageUrlsSet.add(absoluteUrl);
                } catch { /* ignore error */ }
            }
            // Consider srcset as well for higher quality? (More complex)
        });
        completedEvent.imageUrls = Array.from(imageUrlsSet);


        // Latitude/Longitude (Look for schema data or embedded map data)
        let lat: number | null = null;
        let lon: number | null = null;
        $('script[type="application/ld+json"]').each((_i: number, script: cheerio.Element) => {
            try {
                const jsonData = JSON.parse($(script).html() as string || '{}');
                // Handle cases where schema might be nested or in @graph
                const graph = jsonData['@graph'] || [jsonData];
                for (const item of graph) {
                    if (item['@type'] && (String(item['@type']).includes('Event') || item['@type'] === 'Place')) {
                        const location = item.location;
                        if (location && location['@type'] === 'Place' && location.geo) {
                            const geo = location.geo;
                            if (geo['@type'] === 'GeoCoordinates' && geo.latitude && geo.longitude) {
                                const parsedLat = parseFloat(geo.latitude);
                                const parsedLon = parseFloat(geo.longitude);
                                if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
                                    lat = parsedLat;
                                    lon = parsedLon;
                                    break; // Found it
                                }
                            }
                        }
                    }
                }
            } catch { /* Ignore JSON parse errors */ }
            if (lat !== null && lon !== null) return false; // Exit .each if found
        });
        completedEvent.latitude = lat;
        completedEvent.longitude = lon;


    } catch (error) {
        console.error(`Error parsing detail page ${completedEvent.permalink}:`, error);
        completedEvent.description = completedEvent.description ?? `Error parsing details: ${error}`;
    }

    return completedEvent;
}


// --- Main Execution ---

/**
 * Main function to scrape Sei.Jetzt events (first page only).
 * Returns a promise that resolves to an array of ScrapedEvent objects.
 */
export async function scrapeSeijetztEvents(): Promise<ScrapedEvent[]> {
    const allEvents: ScrapedEvent[] = [];
    let currentPage = 1;
    let keepFetching = true;

    console.error("--- Starting Sei.Jetzt Event Scraper ---");

    while (keepFetching) {
        const pageUrl = `${BASE_URL}${START_PATH}?page=${currentPage}`;
        console.error(`\n--- Fetching Page ${currentPage}: ${pageUrl} ---`);

        await Bun.sleep(REQUEST_DELAY_MS); // Delay before each page fetch
        const { html: pageHtml, redirected } = await fetchPage(pageUrl);

        if (redirected) {
            console.error(`Stopped fetching: Redirect detected on page ${currentPage}.`);
            keepFetching = false;
            break;
        }

        if (!pageHtml) {
            console.error(`Failed to fetch page ${currentPage}. Stopping.`);
            keepFetching = false;
            break;
        }

        try {
            const partialEvents = await parseListPage(pageHtml);

            if (partialEvents.length === 0 && currentPage > 1) {
                // Double-check: If a page returns 0 events (and it's not the first page),
                // assume we've reached the end, even without a redirect.
                console.error(`Stopped fetching: No events found on page ${currentPage}.`);
                keepFetching = false;
                break;
            }

            console.error(` Processing ${partialEvents.length} events from page ${currentPage}...`);

            for (const partialEvent of partialEvents) {
                if (!partialEvent.name || !partialEvent.permalink || !partialEvent.startAt) {
                    console.error(` Skipping detail fetch for invalid partial event:`, partialEvent.permalink || 'No permalink');
                    continue;
                }
                console.error(`  Fetching details for: ${partialEvent.name}`);
                const detailedEvent = await fetchEventDetails(partialEvent);
                allEvents.push(detailedEvent);
            }

        } catch (error) {
            console.error(`Error processing page ${currentPage}:`, error);
            // Optionally decide whether to stop on error or continue to next page
            // keepFetching = false; // Uncomment to stop on page processing error
        }

        currentPage++; // Increment page number for the next loop

        keepFetching = false; // Removed this line to allow multi-page scraping
    }

    console.error(`\n--- Scraping finished. Total events collected: ${allEvents.length} ---`);
    return allEvents;
}

// --- Execution Trigger ---

// Execute the main function only when run directly
if (import.meta.main) {
    scrapeSeijetztEvents()
        .then(events => {
            // Output JSON when run directly
            console.log(JSON.stringify(events, null, 2));
        })
        .catch(error => {
            console.error("Unhandled error in main execution:", error);
            process.exit(1); // Exit with error code
        });
}
