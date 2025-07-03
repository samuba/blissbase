import { db, eq, and } from "./db";
import { geocodeCache, reverseGeocodeCache } from "./schema";

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
            console.log(`Found cached geocoding result for "${addressString}"`);
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
            console.log(`Cached geocoding result for "${addressString}"`);
        } catch (cacheError) {
            console.error(`Error caching geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
        }

        return coordinates;
    } catch (error) {
        console.error(`Error geocoding address "${addressString}":`, error instanceof Error ? error.message : String(error));
        return null;
    }
}

/**
 * Reverse geocodes coordinates and returns the city name.
 * First checks the database cache, then calls the reverse geocoding API if not found.
 * @param lat Latitude coordinate
 * @param lng Longitude coordinate
 * @param apiKey Google Maps API key
 * @returns Promise resolving to city name or null if reverse geocoding failed
 */
export async function reverseGeocodeCityCached(lat: number, lng: number, apiKey: string): Promise<string | null> {
    if (!apiKey) {
        console.error('Google Maps API key is not set. Skipping reverse geocoding.');
        return null;
    }

    try {
        // First, check the cache using compound index
        const cachedResult = await db.select()
            .from(reverseGeocodeCache)
            .where(and(
                eq(reverseGeocodeCache.latitude, lat),
                eq(reverseGeocodeCache.longitude, lng)
            ))
            .limit(1);

        if (cachedResult.length > 0 && cachedResult[0].cityName) {
            console.log(`Found cached reverse geocoding result for ${lat},${lng}`);
            return cachedResult[0].cityName;
        }

        // If not in cache, use the reverse geocoding API
        const cityName = await reverseGeocodeCity(lat, lng, apiKey);

        try {
            // Use upsert to insert or update the cache record
            await db.insert(reverseGeocodeCache).values({
                latitude: lat,
                longitude: lng,
                cityName: cityName,
                cachedAt: new Date()
            }).onConflictDoUpdate({
                target: [reverseGeocodeCache.latitude, reverseGeocodeCache.longitude],
                set: {
                    cityName: cityName,
                }
            });
            console.log(`Cached reverse geocoding result for ${lat},${lng}`);
        } catch (cacheError) {
            console.error(`Error caching reverse geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
        }

        return cityName;
    } catch (error) {
        console.error(`Error reverse geocoding coordinates ${lat},${lng}:`, error instanceof Error ? error.message : String(error));
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

async function reverseGeocodeCity(lat: number, lng: number, apiKey: string): Promise<string | null> {
    try {
        console.log("calling google reverse geocode api with", lat, lng);
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=de&region=DE`
        );
        if (!response.ok) {
            console.error(`Reverse geocoding API request failed with status: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (data.status === 'OK' && data.results && data.results.length > 0) {
            // Extract city name from address components
            const addressComponents = data.results[0].address_components;
            const locality = addressComponents.find((component: { types: string[]; long_name: string }) =>
                component.types.includes('locality')
            );
            const administrativeArea = addressComponents.find((component: { types: string[]; long_name: string }) =>
                component.types.includes('administrative_area_level_1')
            );

            // Return city name, or fallback to administrative area
            return locality?.long_name || administrativeArea?.long_name || null;
        } else {
            console.error('Reverse geocoding failed or no results:', data.status, data.error_message);
            return null;
        }
    } catch (error) {
        console.error('Error during reverse geocoding:', error);
        return null;
    }
}