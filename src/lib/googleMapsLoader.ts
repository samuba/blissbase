import { browser } from '$app/environment';
import { PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY } from '$env/static/public';

let placesLibraryPromise: Promise<google.maps.PlacesLibrary | null> | null = null;

export function loadGoogleMapsPlaces() {
	if (!browser) return Promise.resolve(null);

	if (!placesLibraryPromise) {
		placesLibraryPromise = loadPlacesLibrary();
	}

	return placesLibraryPromise;
}

async function loadPlacesLibrary(): Promise<google.maps.PlacesLibrary | null> {
	try {
		if (typeof google !== `undefined` && google.maps?.importLibrary) {
			return (await google.maps.importLibrary(`places`)) as google.maps.PlacesLibrary;
		}

		const apiKey = PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;
		if (!apiKey) return null;

		const { importLibrary, setOptions } = await import(`@googlemaps/js-api-loader`);
		setOptions({ key: apiKey, v: `weekly` });
		return (await importLibrary(`places`)) as google.maps.PlacesLibrary;
	} catch (error) {
		console.error(`Failed to load Google Maps Places library:`, error);
		return null;
	}
}
