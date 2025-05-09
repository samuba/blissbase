/**
 * Fetches event pages from sei.jetzt (starting from https://sei.jetzt/)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from sei.jetzt:
 * - Iterates through pagination pages (currently configured for first page, but adaptable).
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
 *   To scrape from the web: bun run scripts/scrape-seijetzt.ts > seijetzt-events.json
 *   To parse a local file:  bun run scripts/scrape-seijetzt.ts <path_to_html_file> > seijetzt-event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';
import { geocodeAddressFromEvent } from "./common.ts";

const BASE_URL = "https://sei.jetzt";
const START_PATH = "/"; // Main page seems to list events
const REQUEST_DELAY_MS = 600; // Be polite with requests
const USER_AGENT = 'Mozilla/5.0 (compatible; ConsciousPlacesBot/1.0; +https://conscious.place)';

// --- Helper Functions ---

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        await sleep(REQUEST_DELAY_MS / 2); // Small delay even after response starts

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
    // Filter out any obvious HTML DIV tags and other HTML constructs
    if (addressStr.includes('<div class=') || addressStr.includes('role="status"')) {
        return [];
    }

    // Replace <br> with comma for splitting
    addressStr = addressStr.replace(/<br\s*\/?>/gi, ',');

    // Strip HTML tags since we can't use DOM in Node.js
    const textContent = addressStr.replace(/<[^>]*>/g, '');

    const lines = textContent.split(',').map(part => part.trim()).filter(part =>
        part.length > 0 &&
        !part.toLowerCase().includes('karte anzeigen') &&
        !part.toLowerCase().includes('google map')
    );
    console.error(`Address lines extracted: ${JSON.stringify(lines)}`);
    return lines;
}

/**
 * Extracts partial event data from the HTML list page.
 */
async function parseListPage(html: string): Promise<Partial<ScrapedEvent>[]> {
    const $ = cheerio.load(html);
    const events: Partial<ScrapedEvent>[] = [];
    const eventCards = $('div.fi-ta-record');

    console.error(`Found ${eventCards.length} event cards on the page.`);

    eventCards.each((_index, element) => {
        const $card = $(element);
        const $link = $card.find('a[href^="https://sei.jetzt/event/"]').first();

        const permalink = $link.attr('href');
        const name = $link.find('span.text-lg.font-bold').first().text().trim();

        const dateTimeSpans = $link.find('span.text-base.font-bold');
        const startStr = dateTimeSpans.eq(0).text().trim();
        const endStrRaw = dateTimeSpans.length > 1 ? dateTimeSpans.eq(1).text().trim() : null;

        const host = $link.find('span.text-lg.font-bold').closest('.fi-ta-col-wrp').next().find('span.text-sm').first().text().trim();

        const $img = $link.find('img[srcset]');
        let previewImageUrl: string | null = null;
        if ($img.length > 0) {
            const srcset = $img.attr('srcset');
            if (srcset) {
                const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
                if (sources.length > 0) {
                    try {
                        const potentialUrl = sources[sources.length - 1];
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

        let locationName: string | null = null;
        let address: string[] = [];
        const locationIcon = $link.find('svg path[d^="m11.54"]');
        if (locationIcon.length > 0) {
            const locationNameWrapper = locationIcon.closest('.fi-ta-col-wrp')?.next();
            if (locationNameWrapper) {
                locationName = locationNameWrapper.find('span.text-sm').first().text().trim();
                const tooltipWrapper = locationNameWrapper.find('.fi-ta-col-wrp[x-tooltip]');
                const tooltipAttr = tooltipWrapper.attr('x-tooltip');
                if (tooltipAttr) {
                    const match = tooltipAttr.match(/content:\s*'([^']*)'/);
                    if (match && match[1]) {
                        address = parseAddressLines(match[1]);
                    }
                }
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
            hostLink: null,
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
 * Extracts event data from an event detail page HTML, updating an existing ScrapedEvent object.
 * @param htmlContent The HTML content of the event detail page.
 * @param permalink The URL of the event detail page (for context).
 * @param eventToUpdate The ScrapedEvent object to populate/update.
 * @returns The updated ScrapedEvent object or null if essential data is missing or parsing fails.
 */
function extractEventDataFromDetailHtml(htmlContent: string, permalink: string, eventToUpdate: ScrapedEvent): ScrapedEvent | null {
    try {
        const $ = cheerio.load(htmlContent, { decodeEntities: true });
        eventToUpdate.permalink = permalink; // Ensure permalink is set from context

        // --- Extract Name if not already set ---
        if (!eventToUpdate.name || eventToUpdate.name.trim() === '') {
            // Try various selectors for the event name
            const nameSelectors = ['h1', 'h2.event-title', '.event-title', '.title', 'title'];
            for (const selector of nameSelectors) {
                const nameElement = $(selector).first();
                if (nameElement.length > 0) {
                    const name = nameElement.text().trim();
                    if (name && name.length > 0 && !name.toLowerCase().includes('sei.jetzt') && !name.toLowerCase().includes('veranstaltung')) {
                        eventToUpdate.name = name;
                        break;
                    }
                }
            }
        }

        // --- Extract Date and Time (more flexible approach) ---
        const dateFinders = [
            // Standard DL/DT approach
            () => {
                const $dl = $('dl.fi-description-list').first();
                if ($dl.length > 0) {
                    const dateDt = $dl.find('dt:contains("Datum")').first();
                    if (dateDt.length > 0) {
                        return dateDt.next('dd').text().trim();
                    }
                }
                return null;
            },
            // Look for date patterns in the document
            () => {
                const datePatterns = [
                    /(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2})/g, // DD.MM.YYYY HH:MM
                    /(\d{1,2}\.\d{1,2}\.\d{4})/g // DD.MM.YYYY
                ];

                for (const pattern of datePatterns) {
                    const bodyText = $('body').text();
                    const matches = bodyText.match(pattern);
                    if (matches && matches.length > 0) {
                        return matches[0];
                    }
                }
                return null;
            },
            // Look for elements with date/time related classes or text
            () => {
                const dateElements = $('[class*="date"], [class*="time"], [class*="termin"], div:contains("Datum:"), div:contains("Termin:"), span:contains("Datum:")');
                if (dateElements.length > 0) {
                    // Get the first matching element with reasonable text length
                    for (let i = 0; i < dateElements.length; i++) {
                        const text = $(dateElements[i]).text().trim();
                        if (text.length > 5 && /\d{1,2}\.\d{1,2}\./.test(text)) {
                            return text;
                        }
                    }
                }
                return null;
            }
        ];

        // Try each date finder until we get a result
        let dateString: string | null = null;
        for (const finder of dateFinders) {
            dateString = finder();
            if (dateString) {
                console.error(`Found date string: ${dateString}`);
                break;
            }
        }

        if (dateString) {
            // Extract start date
            const dateMatch = dateString.match(/(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/);
            if (dateMatch && dateMatch[1]) {
                const newStartAt = parseGermanDate(dateMatch[1].trim());
                if (newStartAt) {
                    eventToUpdate.startAt = newStartAt;
                    console.error(`Parsed start date: ${newStartAt}`);
                }
            }

            // Extract end date if present
            const endDateMatch = dateString.match(/(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/);
            if (endDateMatch && endDateMatch[2]) {
                const newEndAt = parseGermanDate(endDateMatch[2].trim());
                if (newEndAt) eventToUpdate.endAt = newEndAt;
            } else {
                // Try to find end time only (same day)
                const endTimeMatch = dateString.match(/(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)\s*-\s*(\d{1,2}:\d{2})/);
                if (endTimeMatch && endTimeMatch[1] && endTimeMatch[2] && eventToUpdate.startAt) {
                    // Extract date part from start date
                    const startDatePart = eventToUpdate.startAt.split('T')[0];
                    if (startDatePart) {
                        const endTimeStr = endTimeMatch[2].trim();
                        const [hours, minutes] = endTimeStr.split(':').map(n => parseInt(n, 10));
                        if (!isNaN(hours) && !isNaN(minutes)) {
                            const endAtStr = `${startDatePart}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
                            eventToUpdate.endAt = endAtStr;
                        }
                    }
                }
            }
        }

        // --- Extract Address (more flexible approach) ---
        const addressFinders = [
            // Look for Veranstaltungsort section
            () => {
                const veranstaltungsortText = $('div:contains("Veranstaltungsort"), h3:contains("Veranstaltungsort"), h4:contains("Veranstaltungsort"), dt:contains("Veranstaltungsort"), strong:contains("Veranstaltungsort")');
                if (veranstaltungsortText.length > 0) {
                    for (let i = 0; i < veranstaltungsortText.length; i++) {
                        const element = $(veranstaltungsortText[i]);
                        if (element.text().trim() === 'Veranstaltungsort' || element.text().trim().includes('Veranstaltungsort')) {
                            // Try different ways to get the adjacent content
                            const nextElement = element.next();
                            const parent = element.parent();
                            const parentNext = parent.next();

                            const possibleContainers = [nextElement, parent, parentNext];
                            for (const container of possibleContainers) {
                                if (container.length > 0) {
                                    const addressHTML = container.html();
                                    if (addressHTML) {
                                        const addressLines = parseAddressLines(addressHTML);
                                        if (addressLines.length > 0) {
                                            return addressLines;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                return null;
            },
            // Look for common address patterns in the document
            () => {
                const bodyText = $('body').text();
                const germanAddressRegex = /([A-Za-zäöüÄÖÜßs.-]+\s\d+,\s\d{5}\s[A-Za-zäöüÄÖÜßs.-]+)/g;
                const potentialAddresses = bodyText.match(germanAddressRegex);
                if (potentialAddresses && potentialAddresses.length > 0) {
                    return potentialAddresses[0].split(',').map(part => part.trim());
                }
                return null;
            },
            // Look for "Ort" in description list
            () => {
                const $dl = $('dl.fi-description-list, dl').first();
                if ($dl.length > 0) {
                    const ortDt = $dl.find('dt:contains("Ort")').first();
                    if (ortDt.length > 0) {
                        const ortDd = ortDt.next('dd');
                        if (ortDd.length > 0) {
                            const addressHtml = ortDd.html();
                            if (addressHtml) {
                                return parseAddressLines(addressHtml);
                            }
                        }
                    }
                }
                return null;
            },
            // Look for elements with location/address related classes
            () => {
                const addressElements = $('[class*="address"], [class*="location"], [class*="venue"], [class*="ort"]');
                if (addressElements.length > 0) {
                    for (let i = 0; i < addressElements.length; i++) {
                        const addressText = $(addressElements[i]).text().trim();
                        if (addressText && addressText.length > 5 && /\d{5}/.test(addressText)) { // Contains postal code
                            return addressText.split(',').map(part => part.trim());
                        }
                    }
                }
                return null;
            }
        ];

        // Try each address finder until we get a result
        for (const finder of addressFinders) {
            const address = finder();
            if (address && address.length > 0) {
                eventToUpdate.address = address;
                break;
            }
        }

        // --- Extract Host Information ---
        // Check for a host link in the page header
        const hostLinkElement = $('.flex.flex-row.gap-4.ml-2.z-30.relative.items-center.mb-4.justify-center a');
        if (hostLinkElement.length > 0) {
            const pageHostUrl = hostLinkElement.attr('href');
            if (pageHostUrl) {
                eventToUpdate.hostLink = pageHostUrl;
                const pageHostName = hostLinkElement.find('.text-md.lg\\:text-xl.font-bold').text().trim();
                if (pageHostName) {
                    eventToUpdate.host = pageHostName;
                    console.error(`Extracted host from page header: ${pageHostName}`);
                }
            }
        }

        // If host not found from header, try to find from description
        if (!eventToUpdate.host && eventToUpdate.description) {
            let descHostName: string | null = null;
            let descHostUrl: string | null = null;

            const urlRegex = /https?:\/\/(?:www\.)?([^\/\s]+\.[^\/\s]+)(?:\/[^\s]*)?/g;
            const matches = [...eventToUpdate.description.matchAll(urlRegex)];

            if (matches.length > 0) {
                for (const match of matches) {
                    const url = match[0];
                    // Skip common platforms and sei.jetzt
                    if (url.includes('facebook.com') ||
                        url.includes('youtube.com') ||
                        url.includes('instagram.com') ||
                        url.includes('twitter.com') ||
                        url.includes('google.com') ||
                        url.includes('sei.jetzt')) {
                        continue;
                    }

                    // We found a good URL, use it
                    descHostUrl = url;

                    // Try to extract a name from the domain
                    try {
                        const urlObj = new URL(url);
                        const domain = urlObj.hostname.replace(/^www\./, '');

                        // Get the first part of the domain (before the first dot)
                        const domainParts = domain.split('.');
                        if (domainParts.length >= 2) {
                            // Convert domain name to a proper name format
                            // e.g., "susanne-fabel" -> "Susanne Fabel"
                            descHostName = domainParts[0]
                                .replace(/-/g, ' ')
                                .split(' ')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                        }
                    } catch (_) {
                        // If we can't parse the URL, keep the default name
                    }

                    break; // Use the first good URL we find
                }
            }

            // Only set if we found something and it's not already set from page header
            if (descHostName && !eventToUpdate.host) {
                eventToUpdate.host = descHostName;
            }
            if (descHostUrl && !eventToUpdate.hostLink) {
                eventToUpdate.hostLink = descHostUrl;
            }
        }

        // --- Extract Price ---
        // Look for price patterns in the document
        const pricePatterns = [
            // Look for price info in description list
            () => {
                const $dl = $('dl.fi-description-list, dl').first();
                if ($dl.length > 0) {
                    const priceDt = $dl.find('dt:contains("Preis"), dt:contains("Kosten"), dt:contains("Preise")').first();
                    if (priceDt.length > 0) {
                        return priceDt.next('dd').html();
                    }
                }
                return null;
            },
            // Look for price sections with font-bold heading
            () => {
                // Target the specific price section structure as seen in the example
                const priceSection = $('.font-bold:contains("Preise")').closest('.col-span-2');
                if (priceSection.length > 0) {
                    // Find all direct div children that contain price information
                    const prices: string[] = [];
                    priceSection.find('> div').each((_i, div) => {
                        const priceText = $(div).text().trim();
                        if (priceText && priceText.includes('€') && !priceText.includes('Preise')) {
                            prices.push(priceText);
                        }
                    });
                    return prices.length > 0 ? prices.join('\n') : null;
                }
                return null;
            },
            // Look for price sections with other heading types
            () => {
                const priceHeaders = $('h3:contains("Preise"), h4:contains("Preise"), strong:contains("Preise"), div.font-bold:contains("Preise")');
                if (priceHeaders.length > 0) {
                    const priceHeader = $(priceHeaders[0]);

                    // Try to get all sibling divs containing prices
                    const prices: string[] = [];
                    const currentElement = priceHeader.parent();

                    // Try to get all relevant children containing price information
                    currentElement.find('div').each((_i, el) => {
                        const text = $(el).text().trim();
                        if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i) &&
                            !text.includes("Preise") &&
                            !text.includes("Google") &&
                            !text.includes("Karte")) {
                            prices.push(text);
                        }
                    });

                    if (prices.length > 0) {
                        return prices.join('\n');
                    }

                    // Fallback: try to get the whole HTML section
                    return currentElement.html();
                }
                return null;
            },
            // Look for euro signs in body
            () => {
                const euroRegex = /(\d+([.,]\d+)?\s*€|\d+([.,]\d+)?\s*Euro)/i;
                const bodyText = $('body').text();
                const match = bodyText.match(euroRegex);
                return match ? match[0] : null;
            }
        ];

        // Try each price pattern until we find a price
        for (const finder of pricePatterns) {
            const priceContent = finder();
            if (priceContent) {
                if (typeof priceContent === 'string' &&
                    (priceContent.toLowerCase().includes("kostenlos") ||
                        priceContent.toLowerCase().includes("frei") ||
                        priceContent.toLowerCase().includes("gratis"))) {
                    eventToUpdate.price = "Free";
                } else if (typeof priceContent === 'string' && priceContent.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i)) {
                    // If it's a string with euro symbols, process it as HTML
                    const $priceContainer = $('<div>').html(priceContent);

                    // Extract all the price entries including date ranges and additional info
                    const prices: string[] = [];

                    // Handle various price formats (different HTML structures)
                    // First try divs that directly contain price info
                    $priceContainer.find('div').each((_i, el) => {
                        const text = $(el).text().trim();
                        if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i) &&
                            !text.includes("Google") &&
                            !text.includes("Karte") &&
                            !text.includes("Preise")) {
                            // Fix formatting: replace double parentheses that can occur due to HTML parsing
                            const cleanedText = text.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
                            prices.push(cleanedText);
                        }
                    });

                    // If no prices found in divs, try getting all the text
                    if (prices.length === 0) {
                        const text = $priceContainer.text().trim()
                            .replace(/\s+/g, ' ') // Normalize whitespace
                            .replace(/\(\(/g, '(').replace(/\)\)/g, ')'); // Fix double parentheses

                        // If there's at least one euro sign, use the whole text
                        if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i)) {
                            prices.push(text);
                        }
                    }

                    if (prices.length > 0) {
                        eventToUpdate.price = prices.join("\n");
                    } else {
                        // Fallback: just use the text with normalized spaces
                        const cleanedText = $priceContainer.text().trim()
                            .replace(/\s+/g, ' ')
                            .replace(/\(\(/g, '(').replace(/\)\)/g, ')'); // Fix double parentheses
                        eventToUpdate.price = cleanedText;
                    }
                } else if (typeof priceContent === 'string') {
                    // Plain text without euro symbols
                    eventToUpdate.price = priceContent.trim()
                        .replace(/\s+/g, ' ')
                        .replace(/\(\(/g, '(').replace(/\)\)/g, ')'); // Fix double parentheses
                } else {
                    // It's already a processed string with price info
                    eventToUpdate.price = priceContent;
                }
                break;
            }
        }

        // --- Extract Description ---
        let description: string | null = null;
        const potentialDescSelectors = [
            '.prose', '.entry-content', 'article', '.event-description',
            '.fi-section-content', '.description', '#description',
            'div[class*="description"]', 'div[class*="content"]'
        ];

        for (const selector of potentialDescSelectors) {
            const element = $(selector).first();
            if (element.length > 0 && element.closest('aside, .sidebar').length === 0) {
                const descriptionText = element.text()
                    .trim()
                    .replace(/\s+/g, ' ')  // Normalize whitespace
                    .replace(/\u00A0/g, ' '); // Replace non-breaking spaces

                if (descriptionText && descriptionText.length > 50) {
                    description = descriptionText;
                    break;
                }
            }
        }

        // If we still don't have a description, try to find any substantial text block
        if (!description) {
            $('p').each((_i, p) => {
                const text = $(p).text().trim().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
                if (text.length > 100) {
                    description = text;
                    return false; // break the loop
                }
            });
        }

        eventToUpdate.description = description || eventToUpdate.description;

        // --- Extract Images ---
        const imageUrlsSet = new Set<string>(eventToUpdate.imageUrls || []);

        // Find the first .embla__container element
        const $firstEmblaCont = $('.embla__container').first();

        if ($firstEmblaCont.length > 0) {
            // Look for .embla__slide__img img elements only within the first container
            const $carouselImages = $firstEmblaCont.find('.embla__slide__img img');

            if ($carouselImages.length > 0) {
                $carouselImages.each((_i, img) => {
                    const $img = $(img);
                    const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');
                    if (src && !src.startsWith('data:') && !src.includes('placeholder')) {
                        try {
                            const absoluteUrl = new URL(src, BASE_URL).toString();
                            imageUrlsSet.add(absoluteUrl);
                        } catch { /* ignore error */ }
                    }
                });
            }
        }

        eventToUpdate.imageUrls = Array.from(imageUrlsSet);

        // --- Extract Tags ---
        const tagsSet = new Set<string>(eventToUpdate.tags || []);

        // Attempt 1: DL/DT structure (Kategorien, Tags, Schlagworte)
        if (tagsSet.size === 0) {
            const $dl = $('dl.fi-description-list, dl').first();
            if ($dl.length > 0) {
                const kategorienDt = $dl.find('dt:contains("Kategorien"), dt:contains("Tags"), dt:contains("Schlagworte")').first();
                if (kategorienDt.length > 0) {
                    kategorienDt.next('dd').find('span a, span, a, div.fi-badge').each((_i, el) => {
                        const tagText = $(el).text().trim();
                        if (tagText) {
                            tagsSet.add(tagText);
                        }
                    });
                }
            }
        }

        // Attempt 2: Common class names for tags (often as links or specific elements like chips/badges)
        if (tagsSet.size === 0) {
            $('.tags a, .categories a, .event-tags a, .event-categories a, a.tag, span.tag, div.tag, .chip, .badge, .pill, .fi-badge').each((_i, el) => {
                const tagText = $(el).text().trim();
                if (tagText) {
                    tagsSet.add(tagText);
                }
            });
        }

        // Attempt 3: Structure observed in seijetzt-event2.html (divs inside a specific container)
        if (tagsSet.size === 0) {
            const tagContainer = $('div.flex.flex-grow-1.items-center.gap-2');
            if (tagContainer.length > 0) {
                tagContainer.find('> div').each((_i, el) => { // Direct div children
                    const $el = $(el);
                    // Tags in the example are divs that directly contain text and have no further child elements.
                    if ($el.children().length === 0) {
                        const tagText = $el.text().trim();
                        // Basic sanity check for tag length to avoid overly long strings.
                        if (tagText && tagText.length > 0 && tagText.length < 100) {
                            tagsSet.add(tagText);
                        }
                    }
                });
            }
        }

        eventToUpdate.tags = Array.from(tagsSet);

    } catch (error) {
        console.error(`Error parsing detail page ${permalink}:`, error);
        eventToUpdate.description = eventToUpdate.description ?? `Error parsing details: ${error instanceof Error ? error.message : String(error)}`;
    }

    return eventToUpdate;
}


/**
 * Fetches and parses the detail page for an event, building upon partial data from a list page.
 */
async function fetchEventDetails(partialEventFromList: Partial<ScrapedEvent>): Promise<ScrapedEvent | null> {
    if (!partialEventFromList.name || !partialEventFromList.permalink || !partialEventFromList.startAt) {
        console.error("Cannot fetch details for event with missing name, permalink, or startAt:", partialEventFromList.permalink);
        return null; // Return null if essential identifying info is missing
    }

    // Initialize a full ScrapedEvent object from the partial data
    const completedEvent: ScrapedEvent = {
        name: partialEventFromList.name,
        startAt: partialEventFromList.startAt,
        endAt: partialEventFromList.endAt ?? null,
        address: partialEventFromList.address ?? [],
        price: partialEventFromList.price ?? null,
        description: partialEventFromList.description ?? null,
        imageUrls: partialEventFromList.imageUrls ?? [],
        host: partialEventFromList.host ?? null,
        hostLink: partialEventFromList.hostLink ?? null,
        permalink: partialEventFromList.permalink,
        latitude: partialEventFromList.latitude ?? null,
        longitude: partialEventFromList.longitude ?? null,
        tags: partialEventFromList.tags ?? [],
    };

    await sleep(REQUEST_DELAY_MS);
    const detailHtmlResult = await fetchPage(completedEvent.permalink);

    if (!detailHtmlResult.html) {
        console.error(`Failed to fetch details for: ${completedEvent.permalink}`);
        completedEvent.description = completedEvent.description ?? 'Failed to fetch event details.';
        return completedEvent; // Return the event with whatever data we have
    }

    // Populate/update the event with details from the fetched HTML
    const updatedEvent = extractEventDataFromDetailHtml(detailHtmlResult.html, completedEvent.permalink, completedEvent);

    // Apply geocoding if we have address data
    if (updatedEvent && updatedEvent.address.length > 0) {
        try {
            // Ensure address is in the correct format for geocoding
            const addressToGeocode = Array.isArray(updatedEvent.address) ? updatedEvent.address : [String(updatedEvent.address)];
            if (addressToGeocode.every(item => typeof item === 'string')) {
                console.error(`Geocoding address: ${addressToGeocode.join(', ')}`);
                const coordinates = await geocodeAddressFromEvent(addressToGeocode as string[]);
                if (coordinates) {
                    updatedEvent.latitude = coordinates.lat;
                    updatedEvent.longitude = coordinates.lng;
                    console.error(`Geocoded address to coordinates: ${coordinates.lat}, ${coordinates.lng}`);
                } else {
                    console.error('Geocoding returned no coordinates');
                }
            } else {
                console.warn(`Address for geocoding is not in expected format (string[]):`, updatedEvent.address);
            }
        } catch (error) {
            console.error(`Error during geocoding:`, error instanceof Error ? error.message : String(error));
        }
    }

    return updatedEvent;
}


// --- Main Execution ---

/**
 * Main function to scrape Sei.Jetzt events.
 * Returns a promise that resolves to an array of ScrapedEvent objects.
 */
export async function scrapeSeijetztEvents(): Promise<ScrapedEvent[]> {
    const allEvents: ScrapedEvent[] = [];
    let currentPage = 1;
    let keepFetching = true; // Controls pagination loop

    console.error("--- Starting Sei.Jetzt Event Scraper (Web Mode) ---");

    while (keepFetching) {
        const pageUrl = `${BASE_URL}${START_PATH}?page=${currentPage}`;
        console.error(`\n--- Fetching Page ${currentPage}: ${pageUrl} ---`);

        await sleep(REQUEST_DELAY_MS);
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
                console.error(`Stopped fetching: No events found on page ${currentPage}.`);
                keepFetching = false;
                break;
            }
            if (partialEvents.length === 0 && currentPage === 1) {
                console.warn(`No events found on the first page: ${pageUrl}. This might indicate an issue or an empty site.`);
                keepFetching = false; // Stop if first page is empty
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
                if (detailedEvent) {
                    allEvents.push(detailedEvent);
                } else {
                    console.warn(`Failed to get complete details for event: ${partialEvent.name} (${partialEvent.permalink})`);
                }
            }

        } catch (error) {
            console.error(`Error processing page ${currentPage}:`, error);
            // keepFetching = false; // Optionally stop on page processing error
        }

        currentPage++;
        // For now, let's limit to the first page as per original script's implicit behavior before loop fix
        // Remove the line below to enable multi-page scraping based on `keepFetching` logic
        if (currentPage > 1) { // Process only first page for now.
            console.error("Limiting to first page of results for now. Modify script to remove this limit.");
            keepFetching = false;
        }
    }

    console.error(`\n--- Scraping finished. Total events collected: ${allEvents.length} ---`);
    return allEvents;
}

// --- Execution Trigger ---

// Execute the main function only when run directly
if (import.meta.main) {
    const filePathArg = process.argv[2];

    if (filePathArg) {
        // Local file processing mode
        console.error(`--- Starting Sei.Jetzt Event Scraper (Local File Mode) ---`);
        console.error(`Processing local HTML file: ${filePathArg}...`);
        try {
            const htmlContent = await Bun.file(filePathArg).text();
            // Create a base event object to be populated
            const initialEventData: ScrapedEvent = {
                name: '', // To be filled by parser
                startAt: '', // To be filled by parser
                endAt: null,
                address: [],
                price: null,
                description: null,
                imageUrls: [],
                host: null,
                hostLink: null,
                permalink: filePathArg, // Use file path as permalink for local files
                latitude: null,
                longitude: null,
                tags: [],
            };

            const event = extractEventDataFromDetailHtml(htmlContent, filePathArg, initialEventData);

            if (event) {
                // Basic validation: check if name and startAt were populated
                if (!event.name || !event.startAt) {
                    console.warn(`Extracted event from ${filePathArg} is missing name or startAt. Outputting anyway.`);
                }
                console.log(JSON.stringify(event, null, 2));
                console.error(`--- Successfully processed ${filePathArg} ---`);
            } else {
                console.error(`Could not extract event data from ${filePathArg}.`);
                process.exit(1);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error processing file ${filePathArg}:`, message);
            if (message.includes("ENOENT")) {
                console.error(`Hint: Make sure the file path "${filePathArg}" is correct and the file exists.`);
            }
            process.exit(1);
        }
    } else {
        // Web scraping mode
        scrapeSeijetztEvents()
            .then(events => {
                console.log(JSON.stringify(events, null, 2));
            })
            .catch(error => {
                console.error("Unhandled error in main web scraping execution:", error);
                process.exit(1);
            });
    }
}

