import { getFavoriteEvents } from '$lib/favorites.remote';
import type { PageServerLoad } from './$types';

export const load = (async () => {
    const favoriteEvents = await getFavoriteEvents();
    return {
        favoriteEvents
    };
}) satisfies PageServerLoad;