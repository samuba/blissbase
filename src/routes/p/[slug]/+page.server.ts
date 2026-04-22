import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { saveFiltersToCookie } from '$lib/cookie-utils';

export const load = (async ({ params: { slug }, cookies }) => {
    let plzCity: string | undefined;
    let distance = 50;
    if (slug === "hoi-an") {
        plzCity = "Hoi An";
        distance = 15
    } else if (slug === "danang") {
        plzCity = "Da Nang";
        distance = 30
    } 

    if (plzCity) {
        saveFiltersToCookie(cookies, {
            plzCity,
            distance: distance.toString(),
            lat: null,
            lng: null
        });
    
        redirect(302, `/`);
    }

    error(404, 'Place "' + slug + '" not found');
}) satisfies PageServerLoad;