import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { saveFiltersToCookie } from '$lib/cookie-utils';
import { getPlaces } from '$lib/rpc/places.remote';

export const load = (async ({ params: { slug }, cookies }) => {
    const place = (await getPlaces()).find((place) => place.slug === slug);
    if (!place) {
        error(404, 'Place "' + slug + '" not found');
    }

    saveFiltersToCookie(cookies, {
        plzCity: place.name,
        distance: place.defaultRadius.toString(),
        lat: null,
        lng: null
    });

    redirect(302, `/`);
}) satisfies PageServerLoad;