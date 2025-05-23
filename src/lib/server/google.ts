import { db, eq } from "./db";
import { geocodeCache } from "./schema";

/**
 * Geocodes a location address and returns latitude and longitude.
 * First checks the database cache, then calls the geocoding API if not found.
 * @param addressLines Array of address lines to geocode.
 * @returns Promise resolving to coordinates object or null if geocoding failed.
 */
export async function geocodeAddressCached(addressLines: string[], apiKey: string): Promise<{ lat: number; lng: number } | null> {
    if (!addressLines.length) return null;

    // Join the address lines to create a complete address string
    const addressString = addressLines.filter(x => x?.trim()).join(', ').trim();

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
        const coordinates = await geocodeLocation(addressString, apiKey);

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

async function geocodeLocation(location: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
    if (!apiKey) {
        console.error('Google Maps API key is not set. Skipping geocoding.');
        return null;
    }
    try {
        console.log("calling google geocode api with", location)
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}&language=de&region=DE`
        );
        if (!response.ok) {
            console.error(`Geocoding API request failed with status: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (data.status === 'OK' && data.results && data.results.length > 0) {
            return data.results[0].geometry.location; // { lat, lng }
        } else {
            console.error('Geocoding failed or no results:', data.status, data.error_message);
            return null;
        }
    } catch (error) {
        console.error('Error during geocoding:', error);
        return null;
    }
}