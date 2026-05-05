import { prerender } from '$app/server';
import { db } from '$lib/server/db';

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
