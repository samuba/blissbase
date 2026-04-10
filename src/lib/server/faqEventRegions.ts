/**
 * Extracts a lat/lng bounding box from a Google geocode result geometry.
 *
 * @example
 * extractLatLngBounds({
 * 	bounds: {
 * 		southwest: { lat: 47, lng: 8 },
 * 		northeast: { lat: 48, lng: 9 }
 * 	}
 * })
 */
export function extractLatLngBounds(
	geometry: GoogleGeocodeGeometry | null | undefined
): LatLngBounds | null {
	if (!geometry) return null;

	const bounds = geometry.bounds ?? geometry.viewport;
	if (!bounds) return null;

	return {
		southWestLat: bounds.southwest.lat,
		southWestLng: bounds.southwest.lng,
		northEastLat: bounds.northeast.lat,
		northEastLng: bounds.northeast.lng
	};
}

/**
 * Merges multiple bounding boxes into one larger box.
 *
 * @example
 * mergeLatLngBounds([
 * 	{ southWestLat: 47, southWestLng: 8, northEastLat: 48, northEastLng: 9 },
 * 	{ southWestLat: 48, southWestLng: 9, northEastLat: 49, northEastLng: 10 }
 * ])
 */
export function mergeLatLngBounds(boundsList: LatLngBounds[]): LatLngBounds | null {
	const firstBounds = boundsList[0];
	if (!firstBounds) return null;

	let mergedBounds = { ...firstBounds };

	for (const bounds of boundsList.slice(1)) {
		mergedBounds = {
			southWestLat: Math.min(mergedBounds.southWestLat, bounds.southWestLat),
			southWestLng: Math.min(mergedBounds.southWestLng, bounds.southWestLng),
			northEastLat: Math.max(mergedBounds.northEastLat, bounds.northEastLat),
			northEastLng: Math.max(mergedBounds.northEastLng, bounds.northEastLng)
		};
	}

	return mergedBounds;
}

type LatLngBounds = {
	southWestLat: number;
	southWestLng: number;
	northEastLat: number;
	northEastLng: number;
};

type GoogleGeocodeGeometry = {
	bounds?: GoogleLatLngBounds;
	viewport?: GoogleLatLngBounds;
};

type GoogleLatLngBounds = {
	southwest: GoogleLatLng;
	northeast: GoogleLatLng;
};

type GoogleLatLng = {
	lat: number;
	lng: number;
};
