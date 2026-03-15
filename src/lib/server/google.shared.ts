import { and, eq } from 'drizzle-orm';
import type { DB } from './db.shared';
import { geocodeCache, reverseGeocodeCache } from './schema';

/**
 * Creates geocoding helpers bound to a specific database client.
 *
 * @example
 * const { geocodeAddressCached } = createGoogleCacheApi(db)
 */
export function createGoogleCacheApi(db: DB) {
	const geocodeLocalCache = new Map<string, { lat: number; lng: number }>();

	async function geocodeAddressCached(addressLines: string[] | undefined, apiKey: string): Promise<{ lat: number; lng: number } | null> {
		if (!addressLines?.length) return null;

		const addressString = addressLines.filter((x) => x?.trim()).join(`, `).trim();

		try {
			const localCacheHit = geocodeLocalCache.get(addressString);
			if (localCacheHit) {
				return localCacheHit;
			}

			const dbCachedResult = await db.query.geocodeCache.findFirst({
				where: eq(geocodeCache.address, addressString)
			});

			if (dbCachedResult) {
				console.log(`Found cached geocoding result for "${addressString}" in db: ${dbCachedResult.latitude}, ${dbCachedResult.longitude}`);

				const cachedCoordinates = {
					lat: Number(dbCachedResult.latitude),
					lng: Number(dbCachedResult.longitude)
				};

				geocodeLocalCache.set(addressString, cachedCoordinates);
				return cachedCoordinates;
			}

			const coordinates = await geocodeLocation(addressString, apiKey);

			try {
				await db.insert(geocodeCache).values({
					address: addressString,
					latitude: coordinates?.lat ?? null,
					longitude: coordinates?.lng ?? null,
					cachedAt: new Date()
				});

				console.log(`Cached geocoding result for "${addressString}"`);

				const cachedCoordinates = {
					lat: Number(coordinates?.lat ?? null),
					lng: Number(coordinates?.lng ?? null)
				};

				geocodeLocalCache.set(addressString, cachedCoordinates);
			} catch (cacheError) {
				console.error(`Error caching geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
			}

			return coordinates;
		} catch (error) {
			console.error(`Error geocoding address "${addressString}":`, error instanceof Error ? error.message : String(error));
			return null;
		}
	}

	async function reverseGeocodeCityCached(lat: number, lng: number, apiKey: string): Promise<string | null> {
		if (!apiKey) {
			console.error('Google Maps API key is not set. Skipping reverse geocoding.');
			return null;
		}

		try {
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

			const cityName = await reverseGeocodeCity(lat, lng, apiKey);

			try {
				await db.insert(reverseGeocodeCache).values({
					latitude: lat,
					longitude: lng,
					cityName,
					cachedAt: new Date()
				}).onConflictDoUpdate({
					target: [reverseGeocodeCache.latitude, reverseGeocodeCache.longitude],
					set: {
						cityName
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

	return {
		geocodeAddressCached,
		reverseGeocodeCityCached
	};
}

async function geocodeLocation(location: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
	if (!apiKey) {
		console.error('Google Maps API key is not set. Skipping geocoding.');
		return null;
	}

	try {
		console.log("calling google geocode api with", location);

		const response = await fetch(
			`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}&language=de&region=DE`
		);

		if (!response.ok) {
			console.error(`Geocoding API request failed with status: ${response.status}`);
			return null;
		}

		const data = await response.json();
		console.log('geocodeLocation', data);

		if (data.status === `OK` && data.results?.length) {
			return data.results[0].geometry.location;
		}

		console.error('Geocoding failed or no results:', data.status, data.error_message);
		return null;
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

		if (data.status === `OK` && data.results?.length) {
			const addressComponents = data.results[0].address_components;
			const locality = addressComponents.find((component: { types: string[]; long_name: string }) =>
				component.types.includes(`locality`)
			);
			const administrativeArea = addressComponents.find((component: { types: string[]; long_name: string }) =>
				component.types.includes(`administrative_area_level_1`)
			);

			return locality?.long_name ?? administrativeArea?.long_name ?? null;
		}

		console.error('Reverse geocoding failed or no results:', data.status, data.error_message);
		return null;
	} catch (error) {
		console.error('Error during reverse geocoding:', error);
		return null;
	}
}
