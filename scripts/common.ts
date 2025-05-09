import { geocodeLocation } from "../src/lib/common";
import { geocodeCache } from "../src/lib/server/schema";
import { db, eq } from '../src/lib/server/db.ts';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Common timeout for fetch requests in milliseconds
 */
export const FETCH_TIMEOUT_MS = 10000;

/**
 * Common delay between requests in milliseconds to be polite to servers
 */
export const REQUEST_DELAY_MS = 500;

/**
 * Fetches a URL with a timeout and proper error handling.
 * @param url The URL to fetch
 * @param options Additional fetch options
 * @returns The response text or null if an error occurred
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {}
): Promise<string | null> {
    try {
        console.error(`Fetching: ${url}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            ...options,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ConsciousPlacesBot/1.0; +https://conscious.place)',
                ...(options.headers || {})
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Optional delay after fetch starts (can be adjusted by caller)
        if (options.signal !== controller.signal) {
            // Only sleep if not already aborted
            await new Promise(r => setTimeout(r, 100));
        }

        if (!response.ok) {
            console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
            try {
                const errorBody = await response.text();
                console.error(`Error body: ${errorBody.slice(0, 500)}...`);
            } catch { /* ignore read error */ }
            return null;
        }

        return await response.text();
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            console.error(`Timeout fetching ${url}: Request took longer than ${FETCH_TIMEOUT_MS}ms`);
        } else {
            console.error(`Network error fetching ${url}:`, error);
        }
        return null;
    }
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
 * Attempts to parse German date/time strings into ISO 8601 format.
 * Handles formats like: DD.MM.YYYY, DD.MM.YYYY HH:mm
 * @param dateStr German format date string
 * @returns ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) or null if parsing fails
 */
export function parseGermanDate(dateStr: string): string | null {
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
        if (parsedMonth > 0 && parsedMonth <= 12 && parsedDay > 0 && parsedDay <= 31 &&
            parsedYear > 1900 && parsedHour >= 0 && parsedHour < 24 && parsedMinute >= 0 && parsedMinute < 60) {
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
 * Helper to parse German date/time into ISO string with separate time string
 * @param dateStr Date string (DD.MM.YYYY)
 * @param timeStr Optional time string (HH:mm)
 * @returns ISO date string or null if parsing fails
 */
export function parseGermanDateTime(dateStr: string, timeStr: string | null): string | null {
    if (!dateStr || !/\d{2}\.\d{2}\.\d{4}/.test(dateStr)) {
        return null; // Invalid date format
    }

    const [day, month, year] = dateStr.split('.');
    let isoStr = `${year}-${month}-${day}`;

    if (timeStr) {
        const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
        if (timeMatch) {
            isoStr += `T${timeMatch[1]}:${timeMatch[2]}:00`;
        } else {
            isoStr += `T00:00:00`;
        }
    } else {
        isoStr += `T00:00:00`;
    }

    // Basic validation
    try {
        new Date(isoStr).toISOString();
        return isoStr;
    } catch {
        console.error(`Invalid date generated: ${isoStr} from ${dateStr} ${timeStr}`);
        return null;
    }
}

/**
 * Parses date/time range from a string with start and end
 * @param dateTimeStr String containing date range like "DD.MM.YYYY [HH:mm] - DD.MM.YYYY [HH:mm]"
 * @returns Object with startAt and endAt strings in ISO format
 */
export function parseDateTimeRange(dateTimeStr: string): { startAt: string | null, endAt: string | null } {
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
 * Geocodes a location address and returns latitude and longitude.
 * First checks the database cache, then calls the geocoding API if not found.
 * @param addressLines Array of address lines to geocode.
 * @returns Promise resolving to coordinates object or null if geocoding failed.
 */
export async function geocodeAddressFromEvent(addressLines: string[]): Promise<{ lat: number; lng: number } | null> {
    if (!addressLines.length) return null;

    // Join the address lines to create a complete address string
    const addressString = addressLines.join(', ').trim();

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

        try {
            // Insert a single record
            await db.insert(geocodeCache).values({
                address: addressString,
                latitude: coordinates?.lat ?? null,
                longitude: coordinates?.lng ?? null,
                cachedAt: new Date()
            });
            console.error(`Cached geocoding result for "${addressString}"`);
        } catch (cacheError) {
            console.error(`Error caching geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
        }

        return coordinates;
    } catch (error) {
        console.error(`Error geocoding address "${addressString}":`, error instanceof Error ? error.message : String(error));
        return null;
    }
}