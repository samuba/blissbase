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
	const geocodeLocalCache = new Map<string, GeocodeResult | null>();

	async function geocodeAddressCached(addressLines: string[] | undefined, apiKey: string): Promise<GeocodeResult | null> {
		if (!addressLines?.length) return null;

		const addressString = addressLines.filter((x) => x?.trim()).join(`, `).trim();

		try {
			if (geocodeLocalCache.has(addressString)) {
				return geocodeLocalCache.get(addressString) ?? null;
			}

			const dbCachedResult = await db.query.geocodeCache.findFirst({
				where: eq(geocodeCache.address, addressString)
			});

			if (dbCachedResult) {
				console.log(`Found cached geocoding result for "${addressString}" in db: ${dbCachedResult.latitude}, ${dbCachedResult.longitude}`);

				const cachedGeocodeResult = toCachedGeocodeResult({
					latitude: dbCachedResult.latitude,
					longitude: dbCachedResult.longitude,
					timezone: dbCachedResult.timezone
				});
				if (!cachedGeocodeResult) {
					geocodeLocalCache.set(addressString, null);
					return null;
				}

				if (cachedGeocodeResult.timezone) {
					geocodeLocalCache.set(addressString, cachedGeocodeResult);
					return cachedGeocodeResult;
				}

				const timezone = await getTimezoneForCoordinates({
					lat: cachedGeocodeResult.lat,
					lng: cachedGeocodeResult.lng,
					apiKey
				});
				const geocodeResult = {
					...cachedGeocodeResult,
					timezone
				} satisfies GeocodeResult;

				try {
					await db.update(geocodeCache)
						.set({
							timezone,
							cachedAt: new Date()
						})
						.where(eq(geocodeCache.address, addressString));
				} catch (cacheError) {
					console.error(`Error updating cached timezone: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
				}

				geocodeLocalCache.set(addressString, geocodeResult);
				return geocodeResult;
			}

			const coordinates = await geocodeLocation(addressString, apiKey);
			const timezone = coordinates
				? await getTimezoneForCoordinates({
					lat: coordinates.lat,
					lng: coordinates.lng,
					apiKey
				})
				: null;
			const geocodeResult = coordinates
				? {
					...coordinates,
					timezone
				} satisfies GeocodeResult
				: null;

			try {
				await db.insert(geocodeCache).values({
					address: addressString,
					latitude: coordinates?.lat ?? null,
					longitude: coordinates?.lng ?? null,
					timezone,
					cachedAt: new Date()
				}).onConflictDoUpdate({
					target: geocodeCache.address,
					set: {
						latitude: coordinates?.lat ?? null,
						longitude: coordinates?.lng ?? null,
						timezone,
						cachedAt: new Date()
					}
				});

				console.log(`Cached geocoding result for "${addressString}"`);
			} catch (cacheError) {
				console.error(`Error caching geocoding result: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
			}

			geocodeLocalCache.set(addressString, geocodeResult);
			return geocodeResult;
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

/**
 * Calls the Google Time Zone API for a coordinate pair.
 *
 * @example
 * await getTimezoneForCoordinates({ lat: 48.1351, lng: 11.582, apiKey })
 */
async function getTimezoneForCoordinates(args: { lat: number; lng: number; apiKey: string }): Promise<string | null> {
	if (!args.apiKey) {
		console.error(`Google Maps API key is not set. Skipping timezone lookup.`);
		return null;
	}

	try {
		console.log(`calling google timezone api with`, args.lat, args.lng);

		const timestamp = Math.floor(Date.now() / 1000);
		const response = await fetch(
			`https://maps.googleapis.com/maps/api/timezone/json?location=${args.lat},${args.lng}&timestamp=${timestamp}&key=${args.apiKey}`
		);

		if (!response.ok) {
			console.error(`Timezone API request failed with status: ${response.status}`);
			return null;
		}

		const data = await response.json();
		if (data.status === `OK` && data.timeZoneId) {
			return data.timeZoneId;
		}

		console.error(`Timezone lookup failed or no results:`, data.status, data.errorMessage);
		return null;
	} catch (error) {
		console.error(`Error during timezone lookup:`, error);
		return null;
	}
}

async function geocodeLocation(location: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
	if (!apiKey) {
		console.error(`Google Maps API key is not set. Skipping geocoding.`);
		return null;
	}

	try {
		console.log(`calling google geocode api with`, location);

		const response = await fetch(
			`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}&language=de&region=DE`
		);

		if (!response.ok) {
			console.error(`Geocoding API request failed with status: ${response.status}`);
			return null;
		}

		const data = await response.json();
		console.log(`geocodeLocation`, data);

		if (data.status === `OK` && data.results?.length) {
			return data.results[0].geometry.location;
		}

		console.error(`Geocoding failed or no results:`, data.status, data.error_message);
		return null;
	} catch (error) {
		console.error(`Error during geocoding:`, error);
		return null;
	}
}

async function reverseGeocodeCity(lat: number, lng: number, apiKey: string): Promise<string | null> {
	try {
		console.log(`calling google reverse geocode api with`, lat, lng);

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

		console.error(`Reverse geocoding failed or no results:`, data.status, data.error_message);
		return null;
	} catch (error) {
		console.error(`Error during reverse geocoding:`, error);
		return null;
	}
}

/**
 * Normalizes cached DB values into the public geocode result shape.
 *
 * @example
 * toCachedGeocodeResult({ latitude: 48.1, longitude: 11.5, timezone: `Europe/Berlin` })
 */
function toCachedGeocodeResult(args: {
	latitude: number | null;
	longitude: number | null;
	timezone: string | null;
}): GeocodeResult | null {
	if (args.latitude === null || args.longitude === null) {
		return null;
	}

	return {
		lat: Number(args.latitude),
		lng: Number(args.longitude),
		timezone: args.timezone
	};
}

export type GeocodeResult = {
	lat: number;
	lng: number;
	timezone: string | null;
};
