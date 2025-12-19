import { fetchEvents, prepareEventsResultForUi } from "$lib/server/events";
import type { PageServerLoad } from "./$types";
import { loadFiltersFromCookie } from "$lib/cookie-utils";
import { posthogCapture } from "$lib/server/common";
import { getTags } from "$lib/components/TagSelection.remote";

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
    const tags = await getTags(); // cant do this in TagSelection.svelte cuz it get rerendered via 'if' in template and refetches from server then. Also having it in one component up the tree caused the popover to not be able to close on SSR'd page
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
        tagIds: pagination.tagIds,
        attendanceMode: pagination.attendanceMode
    })

    return {
        events,
        pagination,
        savedFilters,
        tags
    };
}) satisfies PageServerLoad;
