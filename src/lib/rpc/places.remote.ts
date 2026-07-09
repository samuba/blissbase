import { prerender, query } from '$app/server';
import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { db } from '$lib/server/db';
import { reverseGeocodeCityCached } from '$lib/server/google';
import * as v from 'valibot';

/**
 * Returns the public place list used by place pages and profile dropdowns.
 */
export const getPlaces = prerender(async () => {
	return await db.query.places.findMany({
		columns: {
			id: true,
			name: true,
			slug: true,
			defaultRadius: true
		},
		orderBy: (places, { asc }) => [asc(places.name)]
	});
});

export const reverseGeocodeCity = query(
	v.object({
		latitude: v.number(),
		longitude: v.number(),
	}),
	async ({ latitude, longitude }) => {
		return await reverseGeocodeCityCached(latitude, longitude, GOOGLE_MAPS_API_KEY);
	},
);
