import type { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';


export const WEBSITE_SCRAPER_CONFIG = {
    awara: { module: './scrape-awara.ts' },
    tribehaus: { module: './scrape-tribehaus.ts' },
    heilnetz: { module: './scrape-heilnetz.ts' },
    heilnetzowl: { module: './scrape-heilnetzowl.ts' },
    seijetzt: { module: './scrape-seijetzt.ts' },
    ggbrandenburg: { module: './scrape-ggbrandenburg.ts' },
    kuschelraum: { module: './scrape-kuschelraum.ts' },
    ciglobalcalendar: { module: './scrape-ciglobalcalendar.ts' },
    todotoday: { module: './scrape-todotoday.ts' },
    // lumaya: { module: './scrape-lumaya.ts' } wollen die mich verklagen?
} as const;
export const WEBSITE_SCRAPE_SOURCES = Object.keys(WEBSITE_SCRAPER_CONFIG) as (keyof typeof WEBSITE_SCRAPER_CONFIG)[];
export type WebsiteScrapeSource = (typeof WEBSITE_SCRAPE_SOURCES)[number];

export function extractIcalStartAndEndTimes(html: string): { startAt: string | undefined, endAt: string | undefined } {
    const startRegex = /\\nDTSTART:([0-9|T]*)\\/
    const endRegex = /\\nDTEND:([0-9|T]*)\\/
    return {
        startAt: html.match(startRegex)?.[1],
        endAt: html.match(endRegex)?.[1],
    }
}

/**
 * Common timeout for fetch requests in milliseconds
 */
export const FETCH_TIMEOUT_MS = 10000;

/**
 * Common delay between requests in milliseconds to be polite to servers
 */
export const REQUEST_DELAY_MS = 500;

export function customFetch(
    url: string,
    options: RequestInit & { returnType?: 'json' }
): Promise<any>;

export function customFetch(
    url: string,
    options: RequestInit & { returnType?: 'text' }
): Promise<string>;

export function customFetch(
    url: string,
    options: RequestInit & { returnType: 'bytes' }
): Promise<Uint8Array<ArrayBufferLike>>;

/**
 * Fetches a URL with a timeout, retry logic, and proper error handling.
 * @param url The URL to fetch
 * @param options Additional fetch options
 * @returns The response text
 * @throws Error if all retry attempts fail or for non-retryable errors
 */
export async function customFetch(
    url: string,
    options: RequestInit & { returnType?: 'text' | 'bytes' | 'json' } = { returnType: 'text' }
): Promise<string | Uint8Array<ArrayBufferLike>> {
    const maxRetries = 5;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Cap at 10 seconds
                console.warn(`Retry attempt ${attempt}/${maxRetries} for ${url} after ${backoffDelay}ms delay`);
                await Bun.sleep(backoffDelay);
            } else {
                console.log(`Fetching: ${url}`);
            }

            // Create a timeout signal
            const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

            // Combine with any existing signal if provided in options
            const signal = options.signal
                ? AbortSignal.any([options.signal, timeoutSignal])
                : timeoutSignal;

            const response = await fetch(url, {
                ...options,
                headers: {
                    'User-Agent': 'Blissbase',
                    ...(options.headers || {})
                },
                signal
            });

            // Optional delay after fetch starts (can be adjusted by caller)
            if (!signal.aborted) {
                // Only sleep if not already aborted
                await Bun.sleep(100);
            }

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
                console.error(`Error body: ${errorBody}`);

                // Check if error is retryable (5xx server errors or specific network errors)
                if (response.status >= 500 && response.status < 600 && attempt < maxRetries) {
                    lastError = new Error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
                    continue; // Retry on server errors
                }

                throw new Error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
            }

            if (options.returnType === 'bytes') {
                return await response.bytes();
            } else if (options.returnType === 'text') {
                return await response.text();
            } else if (options.returnType === 'json') {
                return await response.json();
            } else {
                throw new Error(`Invalid return type: ${options.returnType}`);
            }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (error instanceof DOMException && error.name === 'AbortError') {
                console.error(`Timeout fetching ${url}: Request took longer than ${FETCH_TIMEOUT_MS}ms`);
            } else {
                console.error(`Network error fetching ${url}:`, error);
            }

            // Don't retry on timeout errors or if we've reached max retries
            if ((error instanceof DOMException && error.name === 'AbortError') || attempt === maxRetries) {
                throw error;
            }
        }
    }

    // This should never be reached, but just in case
    throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

/**
 * Attempts to make a URL absolute if it's relative.
 * @param url The URL string that might be relative.
 * @param baseUrl The base URL to prepend for relative URLs.
 * @returns Absolute URL or the original URL if it's already absolute or not a valid path.
 */
export function makeAbsoluteUrl(url: string | undefined, baseUrl: string): string | undefined {
    if (!url) return undefined;

    if (url.startsWith('/')) {
        return baseUrl + url;
    }

    // Check if URL doesn't start with http:// or https:// and is not a mailto or tel link
    if (!url.startsWith('http://') && !url.startsWith('https://') &&
        !url.startsWith('mailto:') && !url.startsWith('tel:')) {
        // Check if it's a relative path without leading slash
        if (!url.includes(':') && !url.startsWith('#')) {
            return baseUrl + '/' + url;
        }
    }

    return url;
}

/**
 * Attempts to parse German date/time strings into Date objects.
 * Handles formats like: DD.MM.YYYY, DD.MM.YYYY HH:mm
 * @param dateStr German format date string
 * @returns ISO string with timezone offset or null if parsing fails
 */
export function parseGermanDate(dateStr: string | undefined | null): string | undefined {
    if (!dateStr) return undefined;
    dateStr = dateStr.trim();

    const dateTimeRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(\d{1,2}):(\d{2})/;
    const dateRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

    let match = dateStr.match(dateTimeRegex);
    if (match) {
        const [, day, month, year, hour, minute] = match;
        const parsedMonth = parseInt(month); // Month is 1-indexed in input
        const parsedDay = parseInt(day);
        const parsedYear = parseInt(year);
        const parsedHour = parseInt(hour);
        const parsedMinute = parseInt(minute);

        // Basic validation (month 1-12)
        if (parsedMonth >= 1 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 &&
            parsedYear > 1900 && parsedHour >= 0 && parsedHour < 24 && parsedMinute >= 0 && parsedMinute < 60) {
            // Format to ISO string YYYY-MM-DDTHH:mm:ss
            return germanDateToIsoStr(parsedYear, parsedMonth - 1, parsedDay, parsedHour, parsedMinute);
        }
    }

    match = dateStr.match(dateRegex);
    if (match) {
        const [, day, month, year] = match;
        const parsedMonth = parseInt(month); // Month is 1-indexed in input
        const parsedDay = parseInt(day);
        const parsedYear = parseInt(year);

        if (parsedMonth >= 1 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 && parsedYear > 1900) {
            // Format to ISO string YYYY-MM-DD
            return germanDateToIsoStr(parsedYear, parsedMonth - 1, parsedDay);
        }
    }

    console.error(`Could not parse date: "${dateStr}"`);
    return undefined;
}

/**
 * Helper to parse German date/time into ISO string with separate time string
 * @param dateStr Date string (DD.MM.YYYY)
 * @param timeStr Optional time string (HH:mm)
 * @returns ISO date string or null if parsing fails
 */
export function parseGermanDateTime(dateStr: string, timeStr?: string) {
    if (!dateStr || !/\d{2}\.\d{2}\.\d{4}/.test(dateStr)) {
        return undefined; // Invalid date format
    }

    const [day, month, year] = dateStr.split('.');
    const parsedDay = parseInt(day);
    const parsedMonth = parseInt(month) - 1; // Convert to 0-indexed month for germanDateToIsoStr
    const parsedYear = parseInt(year);

    let parsedHour = 0;
    let parsedMinute = 0;

    if (timeStr) {
        const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
        if (timeMatch) {
            parsedHour = parseInt(timeMatch[1]);
            parsedMinute = parseInt(timeMatch[2]);
        }
    }

    // Basic validation
    if (parsedMonth < 0 || parsedMonth > 11 || parsedDay < 1 || parsedDay > 31 ||
        parsedYear < 1900 || parsedHour < 0 || parsedHour > 23 || parsedMinute < 0 || parsedMinute > 59) {
        console.error(`Invalid date/time values: ${dateStr} ${timeStr}`);
        return undefined;
    }

    try {
        return germanDateToIsoStr(parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute);
    } catch (error) {
        console.error(`Error generating ISO string from ${dateStr} ${timeStr}:`, error);
        return undefined;
    }
}

export function superTrim(str: string | undefined | null) {
    if (!str) return undefined;
    return str.trim().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

/**
 * Removes all style and class attributes from HTML
 */
export function cleanProseHtml<T extends string | undefined | null>(html: T): T {
    if (!html) return html;

    const $ = cheerio.load(html);
    // Remove styling attributes from all elements
    $('*').removeAttr('style class align id dir');

    // remvove all p tags that only contain whitespace or &nbsp;
    $('p').each(function () {
        const text = $(this).text();
        if (text.replaceAll('&nbsp;', '').trim() === '') {
            $(this).remove();
        }
    });

    let str = getHtmlBody($);

    const selfMadeLineSeperators = /[—|\-|=|–|‒|⸻|⸺|―|⁓|~|#]{3,}/gm
    str = str.replace(selfMadeLineSeperators, '<hr class="border-primary">');

    str = str.replace(/\n<p>\n<p>/g, '\n<p>').replace(/<p>\n<p>/g, '<p>');
    str = str.replaceAll('<p><br></p>', '');
    str = str.replaceAll('<p>&nbsp;</p>', '');
    str = str.replace(/<br>(\s*<br>){2,}/g, '<br><br>') // Limit consecutive <br> tags to maximum 2, regardless of whitespace between them
    str = linkify(str);
    return str.trim() as T;
}

// Helper function to extract body content from cheerio's full HTML output
function getHtmlBody($: cheerio.Root): string {
    return $.html().replace('<html><head></head><body>', '').replace('</body></html>', '');
}

/**
 * Finds all links which are not already wrapped in <a> tags and wraps them in <a> tags
 */
export function linkify(html: string): string {
    const $ = cheerio.load(html);

    // Find text nodes that contain URLs but are not already inside <a> tags
    $('*').contents().filter(function () {
        return this.nodeType === 3; // Text node
    }).each(function () {
        const text = $(this).text();
        const parent = $(this).parent();

        // Skip if already inside an <a> tag
        if (parent.is('a') || parent.closest('a').length > 0) {
            return;
        }

        // Regular expression to match URLs
        const urlRegex = /(https?:\/\/[^\s<>"]+)/gi;

        if (urlRegex.test(text)) {
            const newHtml = text.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
            $(this).replaceWith(newHtml);
        }
    });

    return getHtmlBody($);
}

function dateToIsoStr(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
    const isoStringLocal = `${year.toString().padStart(4, '0')}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;

    // Create a Date object from this string, but we need to be careful about timezone interpretation
    // We'll create a date that represents "noon on this date" to check the timezone offset
    const referenceDate = new Date(year, month, day, 12, 0, 0);

    // Get the Berlin timezone offset for this date (handles DST automatically)
    const berlinFormatter = new Intl.DateTimeFormat('en', {
        timeZone,
        timeZoneName: 'longOffset'
    });

    const offsetPart = berlinFormatter.formatToParts(referenceDate).find(part => part.type === 'timeZoneName');
    const offset = offsetPart?.value?.match(/[+-]\d{2}:\d{2}/)?.[0] || '+01:00';

    return `${isoStringLocal}${offset}`;
}

/**
 * Converts German date/time components to an ISO string with Berlin timezone offset.
 * Automatically handles daylight saving time (DST) transitions.
 * @param year The year (e.g., 2024)
 * @param month The month (0-indexed, 0 = January, 11 = December)
 * @param day The day of the month (1-31)
 * @param hour The hour (0-23), defaults to 0
 * @param minute The minute (0-59), defaults to 0
 * @returns ISO string with Berlin timezone offset (e.g., "2024-01-15T14:30:00+01:00" or "2024-07-15T14:30:00+02:00")
 */
export function germanDateToIsoStr(year: number, month: number, day: number, hour: number = 0, minute: number = 0) {
    return dateToIsoStr(year, month, day, hour, minute, 'Europe/Berlin');
}

/**
 * Converts Bali date/time components to an ISO string with Bali timezone offset.
 * Bali uses Indonesia Central Time (WITA, UTC+8) with no daylight saving time.
 * @param year The year (e.g., 2024)
 * @param month The month (0-indexed, 0 = January, 11 = December)
 * @param day The day of the month (1-31)
 * @param hour The hour (0-23), defaults to 0
 * @param minute The minute (0-59), defaults to 0
 * @returns ISO string with Bali timezone offset (e.g., "2024-01-15T14:30:00+08:00")
 */
export function baliDateToIsoStr(year: number, month: number, day: number, hour: number = 0, minute: number = 0) {
    return dateToIsoStr(year, month, day, hour, minute, 'Asia/Makassar');
}

export interface WebsiteScraperInterface {
    // scrapes the entire website and returns a list of events
    scrapeWebsite(): Promise<ScrapedEvent[]>;

    // scrapes HTML files and returns a list of events
    scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]>;


    // methods for extracting data from a single event page
    extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined>;
    extractName(html: string): string | undefined;
    extractStartAt(html: string): string | undefined;
    extractEndAt(html: string): string | undefined;
    extractAddress(html: string): string[] | undefined;
    extractPrice(html: string): string | undefined;
    extractDescription(html: string): string | undefined;
    extractImageUrls(html: string): string[] | undefined;
    extractHost(html: string): string | undefined;
    extractHostLink(html: string): string | undefined;
    extractTags(html: string): string[] | undefined;
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}