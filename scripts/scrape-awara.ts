/**
 * Fetches event pages from awara.events (starting from https://awara.events/veranstaltungen)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from awara.events:
 * - Uses AJAX-based pagination to iterate through all pages.
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
 *   To scrape from the web: bun run scripts/scrape-awara.ts > events.json
 *   To parse a local file:  bun run scripts/scrape-awara.ts <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';
import { geocodeAddressFromEvent } from "./common.ts";

const BASE_URL = "https://www.awara.events";
const START_PATH = "/veranstaltungen/";
const REQUEST_DELAY_MS = 500; // Delay between requests to be polite
const LISTINGS_URL = `${BASE_URL}/em-ajax/get_listings/`;

// --- Helper Functions ---

async function fetchPage(url: string): Promise<string | null> {
    try {
        console.error(`Fetching: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ConsciousPlacesBot/1.0; +https://conscious.place)' // Identify bot
            }
        });
        await Bun.sleep(REQUEST_DELAY_MS / 2); // Small delay even after response starts

        if (!response.ok) {
            console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
            // Attempt to read body for more details, e.g. rate limiting messages
            try {
                const errorBody = await response.text();
                console.error(`Error body: ${errorBody.slice(0, 500)}...`);
            } catch { /* ignore read error */ }
            return null;
        }
        return await response.text();
    } catch (error) {
        console.error(`Network error fetching ${url}:`, error);
        return null;
    }
}

/**
 * Fetches event listing data from the AJAX endpoint.
 */
async function fetchListingPageData(page: number): Promise<{ html: string; max_num_pages: string } | null> {
    const formData = new URLSearchParams();
    formData.append('lang', '');
    formData.append('search_keywords', '');
    formData.append('search_location', '');
    formData.append('search_datetimes[]', ''); // Must use [] for array parameters
    formData.append('per_page', '24'); // Or adjust as needed
    formData.append('orderby', 'event_start_date');
    formData.append('order', 'ASC');
    formData.append('page', String(page));
    formData.append('event_online', '');
    formData.append('show_pagination', 'true');
    // Simplified form_data, check if more fields are strictly required by the server
    formData.append('form_data', 'search_keywords=&search_location=&search_within_radius%5B%5D=10&search_distance_units%5B%5D=km&google_map_lat=&google_map_lng=&search_datetimes%5B%5D=&search_orderby%5B%5D=');

    try {
        console.error(`Fetching listings page: ${page}`);
        const response = await fetch(LISTINGS_URL, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': `${BASE_URL}${START_PATH}`, // Important for some checks
                'X-Requested-With': 'XMLHttpRequest', // Important for AJAX detection
                'User-Agent': 'Mozilla/5.0 (compatible; ConsciousPlacesBot/1.0; +https://conscious.place)', // Identify bot
                'Origin': BASE_URL, // Important for CORS
            },
            body: formData.toString(),
        });
        await Bun.sleep(REQUEST_DELAY_MS / 2); // Small delay

        if (!response.ok) {
            console.error(`Error fetching listings page ${page}: ${response.status} ${response.statusText}`);
            try {
                const errorBody = await response.text();
                console.error(`Error body: ${errorBody.slice(0, 500)}...`);
            } catch { /* ignore read error */ }
            return null;
        }
        const jsonResponse = await response.json();
        return { html: jsonResponse.html, max_num_pages: jsonResponse.max_num_pages };
    } catch (error) {
        console.error(`Network error fetching listings page ${page}:`, error);
        return null;
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

        // Basic validation
        if (parsedMonth > 0 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 && parsedYear > 1900 && parsedHour >= 0 && parsedHour < 24 && parsedMinute >= 0 && parsedMinute < 60) {
            // Construct ISO string
            // Note: This doesn't handle timezone conversion. Assumes server/client context is sufficient.
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
            // Format as date only
            return `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(parsedDay).padStart(2, '0')}`;
        }
    }

    console.error(`Could not parse date: "${dateStr}"`);
    return null;
}

/**
 * Parses date/time range strings like "DD.MM.YYYY [HH:mm] - DD.MM.YYYY [HH:mm]"
 * or single dates "DD.MM.YYYY [HH:mm]".
 */
function parseDateTimeRange(dateTimeStr: string): { startAt: string | null, endAt: string | null } {
    const parts = dateTimeStr.split(' - ').map(part => part.trim());
    let startAt: string | null = null;
    let endAt: string | null = null;

    if (parts.length === 0 || !parts[0]) {
        return { startAt: null, endAt: null };
    }

    startAt = parseGermanDate(parts[0]);

    if (parts.length === 2 && parts[1]) {
        // Handle cases like "15:00 - 19:00" where end date is implicit (assume same day as start)
        if (startAt && parts[1].match(/^\d{1,2}:\d{2}$/) && startAt.includes('T')) {
            const startDatePart = startAt.split('T')[0]; // Get YYYY-MM-DD part
            const day = startDatePart.split('-')[2];
            const month = startDatePart.split('-')[1];
            const year = startDatePart.split('-')[0];
            const endDateStr = `${day}.${month}.${year} ${parts[1]}`; // Reconstruct DD.MM.YYYY HH:mm format for parsing
            endAt = parseGermanDate(endDateStr);
        } else {
            // Handle standard end date/datetime
            endAt = parseGermanDate(parts[1]);
        }
    }

    return { startAt, endAt };
}

/**
 * Parses address string into lines, handles "Online-Veranstaltung".
 */
function parseAddress(addressStr: string): string[] {
    if (!addressStr) return [];
    addressStr = addressStr.trim();
    if (addressStr.toLowerCase().includes('online-veranstaltung')) {
        return ["Online Event"];
    }
    // Example: "Mariannenplatz 2 , 10997 Berlin-Kreuzberg , Deutschland"
    return addressStr.split(',').map(part => part.trim()).filter(part => part.length > 0);
}

/**
 * Extracts partial event data from the HTML snippet provided by the AJAX response.
 */
async function parseListPage(html: string): Promise<{ events: Partial<ScrapedEvent>[] }> {
    const $ = cheerio.load(html);
    const events: Partial<ScrapedEvent>[] = [];
    // The AJAX response HTML seems to already contain the event listings directly
    // Adjust selector if the structure within response.html differs significantly
    const eventsOnPage = $('.event_listing');

    console.error(`Found ${eventsOnPage.length} events in HTML snippet.`);

    eventsOnPage.each((_index: number, element: cheerio.Element) => {
        const $element = $(element);
        const permalinkElement = $element.find('a.wpem-event-action-url').first();
        const permalink = permalinkElement.attr('href');
        const name = $element.find('h3.wpem-heading-text').text().trim();
        const dateTimeStr = $element.find('.wpem-event-date-time span').text().trim();
        const locationStr = $element.find('.wpem-event-location span').text().trim();
        const organizerElement = $element.find('.wpem-event-organizer a'); // Link within organizer div
        let host: string | null = null;
        let hostLink: string | null = null;

        if (organizerElement.length > 0) {
            host = organizerElement.map((_i: number, el: cheerio.Element) => $(el).text().trim()).get().join(', '); // Handle multiple organizer links
            hostLink = organizerElement.first().attr('href') ?? null; // Convert undefined to null
        } else {
            // Sometimes the organizer name is just text, not a link
            const organizerNameText = $element.find('.wpem-event-organizer-name').text().trim();
            // Example: "von Some Organizer" or just "von"
            if (organizerNameText.startsWith('von ')) {
                host = organizerNameText.substring(4).trim();
            }
        }

        const bannerStyle = $element.find('.wpem-event-banner-img').attr('style');
        let previewImageUrl: string | null = null;
        if (bannerStyle) {
            const urlMatch = bannerStyle.match(/url\((.*?)\)/);
            if (urlMatch && urlMatch[1]) {
                let rawUrl = urlMatch[1].trim();
                rawUrl = rawUrl.replace(/^['"]|['"]$/g, ''); // Remove potential quotes
                // Handle relative URLs starting with /
                if (rawUrl.startsWith('/')) {
                    rawUrl = BASE_URL + rawUrl;
                }
                try {
                    // Avoid adding placeholder images
                    if (!rawUrl.includes('wpem-placeholder')) {
                        previewImageUrl = new URL(rawUrl).toString();
                    }
                } catch {/* ignore error */ }
            }
        }

        if (!permalink || !name) {
            console.error("Skipping event due to missing permalink or name.");
            // console.error($element.html()); // Log HTML of skipped element for debugging
            return; // Continue to next iteration
        }

        const { startAt, endAt } = parseDateTimeRange(dateTimeStr);
        const address = parseAddress(locationStr);

        // Basic validation: Ensure we have at least a name, link, and start date
        if (!name || !permalink || !startAt) {
            console.error(`Skipping event "${name || 'Unnamed'}" due to missing essential data (name, permalink, or startAt).`);
            return;
        }

        const partialEvent: Partial<ScrapedEvent> = {
            permalink,
            name,
            startAt: startAt, // Already parsed
            endAt: endAt, // Already parsed
            address,
            host,
            hostLink,
            imageUrls: previewImageUrl ? [previewImageUrl] : [],
            price: null,
            description: null,
            latitude: null,
            longitude: null,
            tags: [],
        };
        events.push(partialEvent);
    });

    // No need to find next page link here, pagination is handled in main loop
    console.error(`Parsed ${events.length} events from HTML snippet.`);
    return { events };
}

/**
 * Fetches and parses the detail page for an event, adding missing details.
 */
async function fetchEventDetails(event: Partial<ScrapedEvent>, htmlString?: string): Promise<ScrapedEvent> {
    // Robust check: Ensure essential data from list view is present
    if (!event.name || !event.permalink || !event.startAt) {
        console.error("Cannot fetch details for event with missing name, permalink, or startAt:", event);
        // Return a partially filled/default event structure to avoid crashing
        return {
            name: event.name ?? 'Unknown Event (Incomplete Data)',
            startAt: event.startAt ?? new Date().toISOString(), // Fallback, but should have been caught earlier
            endAt: event.endAt ?? null,
            address: event.address ?? [],
            price: event.price ?? null,
            description: event.description ?? null,
            imageUrls: event.imageUrls ?? [],
            host: event.host ?? null,
            hostLink: event.hostLink ?? null,
            permalink: event.permalink ?? '',
            latitude: event.latitude ?? null,
            longitude: event.longitude ?? null,
            tags: event.tags ?? [],
        };
    }

    // Create a default ScrapedEvent structure from the partial data
    const completedEvent: ScrapedEvent = {
        name: event.name ?? 'Unknown Event',
        startAt: event.startAt ?? new Date().toISOString(), // Default to now if missing (shouldn't happen with validation)
        endAt: event.endAt ?? null,
        address: event.address ?? [],
        price: event.price ?? null,
        description: event.description ?? null,
        imageUrls: event.imageUrls ?? [],
        host: event.host ?? null,
        hostLink: event.hostLink ?? null,
        permalink: event.permalink ?? '', // Should always exist based on prior checks
        latitude: event.latitude ?? null,
        longitude: event.longitude ?? null,
        tags: event.tags ?? [],
    };

    let detailHtml: string | null = null;

    if (htmlString) {
        detailHtml = htmlString;
    } else {
        if (!completedEvent.permalink) {
            console.error(`Skipping detail fetch for event "${completedEvent.name}" due to missing permalink.`);
            return completedEvent; // Return the partially filled event
        }
        await Bun.sleep(REQUEST_DELAY_MS); // Delay before fetching detail page
        detailHtml = await fetchPage(completedEvent.permalink);
    }

    if (!detailHtml) {
        console.error(`Failed to fetch details for: ${completedEvent.permalink}`);
        return completedEvent; // Return the partially filled event
    }

    try {
        const $ = cheerio.load(detailHtml);

        // --- Extract Detail Page Fields ---

        // Description (Prioritize specific event description containers)
        let description: string | null = null;
        const potentialDescSelectors = [
            '.wpem-single-event-body-content', // Added specific selector from example
            '.wpem-single-event-profile .wpem-event-description', // WP Event Manager specific
            '.event-description', // Common class
            '.entry-content',    // WordPress standard
            '.post-content',      // Common class
            'article .content',   // Semantic HTML
            '.elementor-widget-theme-post-content .elementor-widget-container' // Elementor content
        ];

        // Helper function to recursively extract text content with basic formatting
        function extractTextWithFormatting(element: cheerio.Cheerio): string {
            let text = '';
            element.contents().each((_i, node) => {
                const $node = $(node);
                if (node.type === 'text') {
                    const nodeText = $node.text();
                    // Append trimmed text if it contains non-whitespace chars
                    // Add a space after if the overall text doesn't end with whitespace.
                    if (/\S/.test(nodeText)) {
                        const trimmedText = nodeText.replace(/\s+/g, ' ').trim();
                        text += trimmedText + (text.length > 0 && !/\s$/.test(text) ? ' ' : '');
                    }
                } else if (node.type === 'tag') {
                    // Use nodeName which is available in both Element and Tag
                    const tagName = (node as cheerio.TagElement).name.toLowerCase();

                    if (tagName === 'br') {
                        text += '\n';
                    } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol'].includes(tagName)) {
                        // Ensure preceding text has at least one newline if needed
                        if (text.length > 0 && !text.endsWith('\n') && !text.endsWith('\n\n')) {
                            text += '\n';
                        }
                        text += extractTextWithFormatting($node);
                        // Add double newline after block elements for separation
                        text += '\n\n';

                    } else if (tagName === 'li') {
                        text += '- ' + extractTextWithFormatting($node).trim() + '\n'; // Add bullet point and newline

                    } else if (['script', 'style', 'img', 'iframe', 'button', 'input', 'select', 'textarea', 'nav', 'footer', 'header'].includes(tagName)) {
                        // Ignore these tags entirely
                    } else if (tagName === 'a') {
                        // Append link text, adding space if needed
                        const linkText = $node.text().trim();
                        if (linkText) {
                            text += linkText + (text.length > 0 && !/\s$/.test(text) ? ' ' : '');
                        }
                        // Optionally add link href: text += ` (${$node.attr('href')}) `; 
                    }
                    else {
                        // For other inline tags like span, strong, em, just recurse
                        text += extractTextWithFormatting($node);
                    }
                } else if (node.type === 'comment') {
                    // Ignore comments
                }
            });
            return text;
        }

        for (const selector of potentialDescSelectors) {
            const element = $(selector).first();
            if (element.length > 0) {
                // Use the helper function to extract text
                let extractedText = extractTextWithFormatting(element);

                // Clean up extra whitespace and multiple newlines
                extractedText = extractedText
                    .replace(/[ \t]+/g, ' ')          // Collapse horizontal whitespace
                    .replace(/ ?\n ?/g, '\n')        // Remove spaces around newlines
                    .replace(/(\n){3,}/g, '\n\n')    // Collapse 3+ newlines to 2
                    .trim();                       // Trim leading/trailing whitespace/newlines

                if (extractedText) {
                    description = extractedText;
                    console.error(`Description found using selector: ${selector}`);
                    break; // Stop if we found something substantial
                }
            }
        }
        if (!description) {
            console.error(`Description not found for ${completedEvent.permalink}`);
        }
        completedEvent.description = description || null;

        // Host / Host Link (Re-check on detail page, might be more accurate)
        const organizerWrapper = $('.wpem-organizer-profile-wrapper');
        if (organizerWrapper.length > 0) {
            let detailHost: string | null = null;
            let detailHostLink: string | null = null;

            const organizerNameElement = organizerWrapper.find('.wpem-organizer-name').first();

            // Extract host name (prefer span text, fallback to element text)
            detailHost = (organizerNameElement.find('span').first().text() || organizerNameElement.text()).trim();

            // Extract host link: Prioritize the internal profile link ("Mehr Info" button)
            const profileLinkElement = organizerWrapper.find('.wpem-organizer-page-url-button a').first();
            if (profileLinkElement.length > 0) {
                detailHostLink = profileLinkElement.attr('href') || null;
            } else {
                // Fallback: Check if the name itself was linked (less common, but possible)
                const organizerLinkInName = organizerNameElement.find('a').first();
                if (organizerLinkInName.length > 0) {
                    detailHostLink = organizerLinkInName.attr('href') || null;
                }
            }

            // Resolve relative links for hostLink
            if (detailHostLink && detailHostLink.startsWith('/')) {
                detailHostLink = BASE_URL + detailHostLink;
            } else if (detailHostLink) {
                try {
                    detailHostLink = new URL(detailHostLink, BASE_URL).toString();
                } catch {
                    console.error(`Invalid host link URL found: ${detailHostLink}`);
                    detailHostLink = null; // Invalidate bad URLs
                }
            }

            // Update event only if we found new info on the detail page
            if (detailHost) {
                completedEvent.host = detailHost;
                // We only update the link if we also found a host name on the detail page
                completedEvent.hostLink = detailHostLink;
            }
        }

        // Image URLs (Collect meaningful images within the main content area)
        const detailImageUrls: string[] = [];
        const contentAreaSelector = '.wpem-single-event-profile, .entry-content, article, .elementor-widget-container'; // Broad selectors
        $(contentAreaSelector).find('img').each((_i, img) => {
            const $img = $(img);
            let src = $img.attr('src');
            // Handle lazy loading (common attributes: data-src, data-lazy-src)
            if (!src) src = $img.attr('data-src') || $img.attr('data-lazy-src');
            const srcset = $img.attr('srcset') || $img.attr('data-srcset');

            let potentialSrc: string | undefined = src;
            // Prefer higher resolution from srcset if available
            if (srcset) {
                const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
                if (sources.length > 0) potentialSrc = sources[sources.length - 1]; // Take the last (likely largest) URL
            }

            if (potentialSrc) {
                // Basic filtering
                if (!potentialSrc.startsWith('data:') && !potentialSrc.includes('avatar') && !potentialSrc.includes('icon') && !potentialSrc.includes('placeholder') && !potentialSrc.includes('logo')) {
                    // Resolve relative URLs
                    if (potentialSrc.startsWith('/')) {
                        potentialSrc = BASE_URL + potentialSrc;
                    }
                    try {
                        const absoluteUrl = new URL(potentialSrc, BASE_URL).toString();
                        if (!detailImageUrls.includes(absoluteUrl)) {
                            detailImageUrls.push(absoluteUrl);
                        }
                    } catch {/* ignore error */ }
                }
            }
        });
        // Combine with preview image, ensure uniqueness
        completedEvent.imageUrls = Array.from(new Set([...completedEvent.imageUrls, ...detailImageUrls]));


        // Price (Look for schema data, specific price elements, ticket sections)
        let price: string | null = null;
        // 1. Check Schema.org data (LD+JSON) - Most reliable if present
        $('script[type="application/ld+json"]').each((_i: number, script: cheerio.Element) => {
            try {
                const jsonData = JSON.parse($(script).html() as string || '{}');
                const graph = jsonData['@graph'] || [jsonData]; // Handle graph structures
                for (const item of graph) {
                    // Check type includes 'Event' or specific subtypes
                    if (item['@type'] && (String(item['@type']).includes('Event') || String(item['@type']).includes('SaleEvent'))) {
                        if (item.offers) {
                            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers; // Take first offer
                            if (offer) {
                                if (offer.priceSpecification) {
                                    const spec = offer.priceSpecification;
                                    price = `${spec.priceCurrency || ''} ${spec.price}`.trim();
                                    break;
                                } else if (offer.price) {
                                    price = `${offer.priceCurrency || ''} ${offer.price}`.trim();
                                    break;
                                } else if (typeof offer === 'string') { // Sometimes offer is just price string
                                    price = offer;
                                    break;
                                } else if (offer.lowPrice && offer.highPrice) { // Price range
                                    price = `${offer.priceCurrency || ''} ${offer.lowPrice} - ${offer.highPrice}`.trim();
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch { /* Ignore JSON parsing errors */ }
            if (price) return false; // Exit .each if found
        });

        // Define selectors commonly used for price
        const priceSelectors: string[] = [
            '.wpem-single-event-profile .event-price',
            '.wpem-event-ticket-price .woocommerce-Price-amount amount', // WooCommerce price
            '.price',
            '.ticket-price',
            '.entry-content .cost',
            // Check for ticket form elements
            '.wpem-event-tickets tfoot .woocommerce-Price-amount amount', // Total in ticket form
            '.event-tickets .amount'
        ];

        // 2. Fallback: Look for common price/ticket elements (adjust selectors as needed)
        if (!price) {
            for (const selector of priceSelectors) {
                const element = $(selector).first();
                if (element.length > 0) {
                    const priceText = element.text().trim();
                    // Basic cleanup: remove currency symbols if currency is already implied/known
                    // priceText = priceText.replace(/[€$]/g, '').trim();
                    if (priceText && !priceText.toLowerCase().includes('kostenlos') && !priceText.toLowerCase().includes('free')) {
                        price = priceText;
                        break;
                    }
                }
            }
        }
        // Handle "Free" or "Kostenlos" case after checking numerical prices
        if (!price) {
            const freeSelectors: string[] = [ /* Add selectors pointing specifically to 'free' indicators if necessary */];
            for (const selector of [...priceSelectors, ...freeSelectors]) {
                const element = $(selector).first();
                if (element.length > 0) {
                    const priceText = element.text().trim().toLowerCase();
                    if (priceText.includes('kostenlos') || priceText.includes('free')) {
                        price = "Free";
                        break;
                    }
                }
            }
        }
        completedEvent.price = price;


        // Latitude/Longitude (Look for schema data or embedded map data)
        let lat: number | null = null;
        let lon: number | null = null;
        // 1. Check Schema.org data (LD+JSON)
        $('script[type="application/ld+json"]').each((_i: number, script: cheerio.Element) => {
            try {
                const jsonData = JSON.parse($(script).html() as string || '{}');
                const graph = jsonData['@graph'] || [jsonData];
                for (const item of graph) {
                    if (item.location && item.location['@type'] === 'Place' && item.location.geo) {
                        const geo = item.location.geo;
                        if (geo['@type'] === 'GeoCoordinates' && geo.latitude && geo.longitude) {
                            lat = parseFloat(geo.latitude);
                            lon = parseFloat(geo.longitude);
                            if (!isNaN(lat) && !isNaN(lon)) break;
                        }
                    }
                }
            } catch { /* Ignore JSON parse errors */ }
            if (lat !== null && lon !== null) return false; // Exit .each
        });

        // 2. Fallback: Look for embedded map data (e.g., Leaflet, Google Maps init) - Highly site-specific
        // Example check for Leaflet:
        if (lat === null || lon === null) {
            $('script').each((_i: number, script: cheerio.Element) => {
                const scriptContent = $(script).html();
                if (scriptContent) {
                    // Very basic check for Leaflet setView pattern
                    const leafletMatch = scriptContent.match(/L\.map\(.*?\)\.setView\(\s*\[\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\]/);
                    if (leafletMatch) {
                        lat = parseFloat(leafletMatch[1]);
                        lon = parseFloat(leafletMatch[2]);
                        if (!isNaN(lat) && !isNaN(lon)) return false; // Exit .each
                    }
                    // Could add checks for Google Maps `new google.maps.Map` initializations
                }
            });
        }

        completedEvent.latitude = (lat !== null && !isNaN(lat)) ? lat : null;
        completedEvent.longitude = (lon !== null && !isNaN(lon)) ? lon : null;

        // Try to geocode if we don't have coordinates but have an address
        if ((completedEvent.latitude === null || completedEvent.longitude === null) && completedEvent.address && completedEvent.address.length > 0) {
            try {
                const coordinates = await geocodeAddressFromEvent(completedEvent.address);
                if (coordinates) {
                    completedEvent.latitude = coordinates.lat;
                    completedEvent.longitude = coordinates.lng;
                    console.error(`Geocoded address for "${completedEvent.name}"`);
                }
            } catch (error) {
                console.error(`Error geocoding address for "${completedEvent.name}":`, error);
            }
        }

        // Tags/Categories (Combine schema keywords, visible tags/categories, event type)
        const tags: Set<string> = new Set(completedEvent.tags); // Start with any tags from list view

        // 1. From Schema.org keywords
        $('script[type="application/ld+json"]').each((_i: number, script: cheerio.Element) => {
            try {
                const jsonData = JSON.parse($(script).html() as string || '{}');
                const graph = jsonData['@graph'] || [jsonData];
                for (const item of graph) {
                    if (item['@type'] && item['@type'].includes('Event') && item.keywords) {
                        let keywords = item.keywords;
                        if (typeof keywords === 'string') keywords = keywords.split(',').map(k => k.trim());
                        if (Array.isArray(keywords)) keywords.forEach(k => { if (k) tags.add(k); });
                    }
                    // Also check event categories often stored under 'about' or 'additionalType'
                    let potentialCats = item.about || item.additionalType;
                    if (potentialCats) {
                        if (!Array.isArray(potentialCats)) potentialCats = [potentialCats];
                        potentialCats.forEach((cat: unknown) => {
                            if (typeof cat === 'string' && cat) tags.add(cat);
                            else if (cat && typeof cat === 'object' && 'name' in cat && typeof cat.name === 'string') tags.add(cat.name);
                        });
                    }
                }
            } catch { /* Ignore JSON parse errors */ }
        });

        // 2. From visible category/tag links (adjust selectors based on inspection)
        const tagSelectors = [
            '.wpem-event-categories a', // WP Event Manager specific
            '.wpem-event-type a span.wpem-event-type-text', // Event Type text inside link
            '.wpem-event-type a', // Event Type link
            '.event-categories a',
            '.event-tags a',
            '.post-tags a',
            '.entry-meta .categories a',
            '.entry-footer .tags-links a', // Common theme locations
            '.elementor-post-info__terms-list-item a' // Elementor tags
        ];
        for (const selector of tagSelectors) {
            // Using for...of loop to potentially help with TypeScript type inference
            const tagElements = $(selector);
            for (const tagEl of tagElements.get()) { // .get() returns an array of DOM elements
                // Check if it's an Element node before accessing text()
                if (tagEl.type === 'tag') {
                    const rawTagText = $(tagEl).text();
                    const cleanedTagText = rawTagText.replace(/\s+/g, ' ').trim();
                    if (cleanedTagText) tags.add(cleanedTagText);
                }
            }
        }

        completedEvent.tags = Array.from(tags);


    } catch (error) {
        console.error(`Error parsing detail page ${completedEvent.permalink}:`, error);
    }

    console.log(completedEvent);

    return completedEvent;
}

/**
 * Process a single HTML file (provided as a path) and extract event data.
 * @param htmlContent The HTML content to process
 * @param filePath The file path (used as fallback permalink)
 * @returns A ScrapedEvent object or null if extraction failed
 */
async function processLocalHtmlFile(htmlContent: string, filePath: string): Promise<ScrapedEvent | null> {
    // Create a placeholder permalink using the file path
    const permalink = `file://${filePath}`;

    try {
        const $ = cheerio.load(htmlContent);

        // Attempt to find the actual URL if it exists in the HTML
        let actualUrl = $('meta[property="og:url"]').attr('content');
        if (!actualUrl) {
            actualUrl = $('link[rel="canonical"]').attr('href');
        }

        // Extract more details directly from the HTML for local file processing
        let name = $('h1.entry-title').first().text().trim();
        if (!name) {
            name = $('.wpem-event-title h3.wpem-heading-text').first().text().trim();
        }
        if (!name) {
            name = $('title').first().text().trim().replace(" - AWARA Events", ""); // Fallback to title tag
        }


        const dateTimeElements = $('.wpem-event-date-time span.wpem-event-date-time-text');
        let startAtLocal: string | null = null;
        let endAtLocal: string | null = null;

        if (dateTimeElements.length > 0) {
            const dateTimeStr = dateTimeElements.map((_i, el) => $(el).text().trim()).get().join(' - ');
            const parsedDates = parseDateTimeRange(dateTimeStr);
            startAtLocal = parsedDates.startAt;
            endAtLocal = parsedDates.endAt;
        }

        let addressLocal: string[] = [];
        const addressHeading = $('h3.wpem-heading-text').filter((_i, el) => $(el).text().trim() === "Adresse");
        if (addressHeading.length > 0) {
            const addressDiv = addressHeading.first().next('div');
            if (addressDiv.length > 0) {
                // Get raw HTML, replace <br> with newlines for parseAddress
                const addressHtml = addressDiv.html()?.replace(/<br\s*\/?>/gi, '\n');
                const $tempAddress = cheerio.load(`<div>${addressHtml || ''}</div>`);
                addressLocal = parseAddress($tempAddress('div').text());
            }
        }


        const imageUrlsLocal: string[] = [];
        const mainImageSrc = $('.wpem-event-single-image img').attr('src');
        if (mainImageSrc) {
            imageUrlsLocal.push(mainImageSrc);
        }

        let hostLocal: string | null = null;
        let hostLinkLocal: string | null = null;
        const organizerLinkElement = $('.wpem-event-organizer-name a').first();
        if (organizerLinkElement.length > 0) {
            hostLocal = organizerLinkElement.text().trim();
            hostLinkLocal = organizerLinkElement.attr('href') || null;
        } else {
            const organizerNameText = $('.wpem-event-organizer-name').first().text().trim();
            if (organizerNameText.startsWith('von ')) {
                hostLocal = organizerNameText.substring(4).trim();
            }
        }
        if (hostLinkLocal && hostLinkLocal.startsWith('/')) {
            hostLinkLocal = BASE_URL + hostLinkLocal;
        }


        let priceLocal: string | null = null;
        const priceHeading = $('h3.wpem-heading-text').filter((_i, el) => $(el).text().trim() === "Preis");
        if (priceHeading.length > 0) {
            const priceDiv = priceHeading.first().next('div');
            if (priceDiv.length > 0) {
                priceLocal = priceDiv.text().trim();
                // Basic price cleaning, can be expanded
                if (priceLocal) {
                    priceLocal = priceLocal.replace(/EUR/gi, '').replace(/ab /gi, '').replace(/bis /gi, '- ').trim();
                    if (priceLocal.endsWith("-")) priceLocal = priceLocal.slice(0, -1).trim();
                }
            }
        }

        const tagsLocal: string[] = [];
        $('.wpem-event-type a .wpem-event-type-text').each((_i, el) => {
            const rawTagText = $(el).text();
            const cleanedTagText = rawTagText.replace(/\s+/g, ' ').trim();
            if (cleanedTagText) tagsLocal.push(cleanedTagText);
        });
        $('.wpem-event-category a .wpem-event-category-text').each((_i, el) => {
            const rawTagText = $(el).text();
            const cleanedTagText = rawTagText.replace(/\s+/g, ' ').trim();
            if (cleanedTagText) tagsLocal.push(cleanedTagText);
        });

        // Create a partial event with basic info
        const partialEvent: Partial<ScrapedEvent> = {
            permalink: actualUrl || permalink,
            name: name || 'Unknown Event',
            startAt: startAtLocal === null ? undefined : startAtLocal,
            endAt: endAtLocal === null ? undefined : endAtLocal,
            address: addressLocal,
            imageUrls: imageUrlsLocal,
            host: hostLocal === null ? undefined : hostLocal,
            hostLink: hostLinkLocal === null ? undefined : hostLinkLocal,
            price: priceLocal === null ? undefined : priceLocal,
            tags: Array.from(new Set(tagsLocal)), // Remove duplicates
        };

        // Use the existing detail page processing logic which will handle LD+JSON and further refine/add fields
        return await fetchEventDetails(partialEvent, htmlContent);
    } catch (error) {
        console.error(`Error processing local HTML file ${filePath}:`, error);
        return null;
    }
}

// --- Main Scraping Function ---
/**
 * Main function to scrape Awara events.
 * Returns a promise that resolves to an array of ScrapedEvent objects.
 */
export async function scrapeAwaraEvents(): Promise<ScrapedEvent[]> {
    const allEvents: ScrapedEvent[] = [];
    let currentPage = 1;
    let maxPages = 1; // Start with 1, will be updated after first fetch
    let pageCount = 0;
    const safetyBreak = 50; // Safety break limit

    console.error("--- Starting Awara Event Scraper (AJAX Version) ---");

    // Initial fetch to get total pages
    console.error(`--- Fetching page 1 to determine total pages ---`);
    await Bun.sleep(REQUEST_DELAY_MS); // Delay before first fetch
    const initialData = await fetchListingPageData(currentPage);

    if (!initialData || !initialData.html) {
        console.error("Failed to fetch initial page data. Stopping.");
        return []; // Exit if first page fails
    }

    if (initialData.max_num_pages) {
        maxPages = parseInt(initialData.max_num_pages, 10);
        if (isNaN(maxPages) || maxPages <= 0) {
            console.error(`Invalid max_num_pages received: ${initialData.max_num_pages}. Assuming 1 page.`);
            maxPages = 1;
        } else {
            console.error(`Total pages determined: ${maxPages}`);
        }
    } else {
        console.error("Could not determine total number of pages from initial response. Assuming 1 page.");
        maxPages = 1;
    }


    // Process the first page's data before starting the loop for subsequent pages
    try {
        const { events: initialPartialEvents } = await parseListPage(initialData.html);

        if (initialPartialEvents.length === 0 && maxPages <= 1) {
            console.error("No events found on the first page and no other pages indicated. Exiting.");
            return []; // Output empty array
        }

        console.error(`Processing ${initialPartialEvents.length} events from page ${currentPage}...`);
        for (const partialEvent of initialPartialEvents) {
            if (!partialEvent.name || !partialEvent.permalink || !partialEvent.startAt) {
                console.error(`Skipping detail fetch for invalid partial event on page ${currentPage}:`, partialEvent);
                continue;
            }
            console.error(` Fetching details for: ${partialEvent.name}`);
            const detailedEvent = await fetchEventDetails(partialEvent);
            allEvents.push(detailedEvent);
        }
        pageCount++;
        currentPage++; // Move to page 2 for the loop

    } catch (error) {
        console.error(`Error processing initial list page data (page 1):`, error);
        // Decide if we should stop or try to continue? Stopping is safer.
        console.error("Stopping due to error on initial page processing.");
        return [];
    }


    // Loop through remaining pages
    while (currentPage <= maxPages && pageCount < safetyBreak) {
        pageCount++;
        console.error(`--- Processing Page ${currentPage} of ${maxPages} ---`);

        await Bun.sleep(REQUEST_DELAY_MS); // Delay before fetching next list page
        const pageData = await fetchListingPageData(currentPage);

        if (!pageData || !pageData.html) {
            console.error(`Failed to fetch listing data for page ${currentPage}. Attempting to continue or stopping? (Stopping for now)`);
            // Optionally: could implement retry logic here
            break; // Stop if a page fetch fails
        }


        try {
            const { events: partialEvents } = await parseListPage(pageData.html);

            if (partialEvents.length === 0 && currentPage === maxPages) {
                console.error(`No events found on the last page (${currentPage}).`);
                // This is expected if the last page is empty, continue to finish
            } else if (partialEvents.length === 0) {
                console.error(`Warning: No events found on page ${currentPage}, but not the last page. Continuing...`);
            }

            console.error(`Processing ${partialEvents.length} events from page ${currentPage}...`);
            for (const partialEvent of partialEvents) {
                if (!partialEvent.name || !partialEvent.permalink || !partialEvent.startAt) {
                    console.error(`Skipping detail fetch for invalid partial event on page ${currentPage}:`, partialEvent);
                    continue;
                }
                console.error(` Fetching details for: ${partialEvent.name}`);
                const detailedEvent = await fetchEventDetails(partialEvent);
                allEvents.push(detailedEvent);
            }

        } catch (error) {
            console.error(`Error processing list page ${currentPage}:`, error);
            console.error("Stopping loop due to error processing page data.");
            break; // Stop the loop if parsing fails
        }

        currentPage++; // Move to the next page

    } // End while loop

    if (pageCount >= safetyBreak) {
        console.error(`Stopped scraping after reaching maximum page limit (${safetyBreak}). Potential issue or many pages.`);
    }

    console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
    return allEvents; // Return the collected events
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
                const event = await processLocalHtmlFile(htmlContent, filePathArg);
                if (event) {
                    console.log(JSON.stringify(event, null, 2));
                    console.error(`--- Successfully processed ${filePathArg} ---`);
                } else {
                    console.error(`Could not extract event data from ${filePathArg}.`);
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
        scrapeAwaraEvents()
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
