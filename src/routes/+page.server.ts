import { fetchEvents, prepareEventsResultForUi } from "$lib/server/events";
import type { PageServerLoad } from "./$types";
import { loadFiltersFromCookie } from "$lib/cookie-utils";
import { posthogCapture } from "$lib/server/common";

export const load = (async ({ cookies }) => {
    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);

    // Merge saved filters with default parameters
    const defaultParams = {
        page: 1,
        limit: 7
    };

    const params = savedFilters ? { ...defaultParams, ...savedFilters } : defaultParams;

    const { events, pagination } = prepareEventsResultForUi(await fetchEvents(params));
    posthogCapture('events_fetched', {
        events: events.length,
        totalEvents: pagination.totalEvents,
        totalPages: pagination.totalPages,
        lat: pagination.lat,
        lng: pagination.lng,
        plzCity: pagination.plzCity,
        distance: pagination.distance,
        searchTerm: pagination.searchTerm,
        sortBy: pagination.sortBy,
        sortOrder: pagination.sortOrder,
        tagIds: pagination.tagIds
    })

    return {
        events,
        pagination,
        savedFilters
    };
}) satisfies PageServerLoad;
