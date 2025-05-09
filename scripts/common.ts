import { geocodeLocation } from "../src/lib/common";
import { geocodeCache } from "../src/lib/server/schema";
import { db, eq } from '../src/lib/server/db.ts';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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
            await db.insert(geocodeCache).values({
                address: addressString,
                latitude: coordinates?.lat, // even save lat/lng when null to avoid re-geocoding
                longitude: coordinates?.lng,
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