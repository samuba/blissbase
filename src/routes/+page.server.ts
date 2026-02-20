import { fetchEvents, prepareEventsResultForUi } from "$lib/server/events";
import type { PageServerLoad } from "./$types";
import { loadFiltersFromCookie, LOCATION_INTERACTED_COOKIE_NAME, saveFiltersToCookie } from "$lib/cookie-utils";
import { posthogCapture } from "$lib/server/common";
import { getTags } from "$lib/components/TagSelection.remote";

export const load = (async ({ cookies, locals }) => {
    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);
    const userAlreadySetLocation = Boolean(cookies.get(LOCATION_INTERACTED_COOKIE_NAME));

    // Merge saved filters with default parameters
    const defaultParams = {
        page: 1,
        limit: 8
    };

    let params = savedFilters ? { ...defaultParams, ...savedFilters } : defaultParams;
    const hasSavedLocation = Boolean(
        savedFilters?.plzCity?.trim() ||
        (savedFilters?.lat != null && savedFilters?.lng != null)
    );

    let autoDetectedCity: string | null = null;
    if (!hasSavedLocation && !userAlreadySetLocation && locals.requestInfo?.city) {
        let decodedCity = locals.requestInfo.city.trim();
        try {
            decodedCity = decodeURIComponent(decodedCity).trim();
        } catch {
            // keep original city string if header is not URI-encoded
        }
        if (decodedCity) {
            autoDetectedCity = decodedCity;
            params = { ...params, plzCity: decodedCity, distance: '50' };
            saveFiltersToCookie(cookies, {
                ...(savedFilters ?? {}),
                plzCity: decodedCity,
                distance: '50',
                lat: null,
                lng: null
            });
        }
    }

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
        autoDetectedCity,
        tags
    };
}) satisfies PageServerLoad;
