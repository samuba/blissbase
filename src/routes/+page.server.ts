import { fetchEvents } from "$lib/server/events";
import type { PageServerLoad } from "./$types";
import { loadFiltersFromCookie } from "$lib/cookie-utils";

export const load = (async ({ cookies }) => {
    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);

    // Merge saved filters with default parameters
    const defaultParams = {
        page: 1,
        limit: 7
    };

    const params = savedFilters ? { ...defaultParams, ...savedFilters } : defaultParams;

    const { events, pagination } = await fetchEvents(params);

    return {
        events,
        pagination,
        savedFilters
    };
}) satisfies PageServerLoad;
