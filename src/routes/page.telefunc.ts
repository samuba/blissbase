import { fetchEvents } from "$lib/server/events";
import { loadFiltersFromCookie, saveFiltersToCookie } from "$lib/cookie-utils";
import { getContext } from "telefunc";
import type { Cookies } from '@sveltejs/kit';

export async function fetchEventsWithCookiePersistence(params: Parameters<typeof fetchEvents>[0]) {
    const context = getContext<{ cookies: Cookies }>();
    const cookies = context?.cookies;

    if (!cookies) {
        // Fallback to regular fetchEvents if no cookies context
        return fetchEvents(params);
    }

    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);

    // Check if the current params are different from saved filters
    const hasChanged = savedFilters ? (
        params.startDate !== savedFilters.startDate ||
        params.endDate !== savedFilters.endDate ||
        params.plzCity !== savedFilters.plzCity ||
        params.distance !== savedFilters.distance ||
        params.lat !== savedFilters.lat ||
        params.lng !== savedFilters.lng ||
        params.searchTerm !== savedFilters.searchTerm ||
        params.sortBy !== savedFilters.sortBy ||
        params.sortOrder !== savedFilters.sortOrder
    ) : true;

    // Fetch events with current params
    const result = await fetchEvents(params);

    // Save to cookie only if params have changed (and not on pagination)
    if (hasChanged && params.page === 1) {
        const filterData = {
            startDate: params.startDate,
            endDate: params.endDate,
            plzCity: params.plzCity,
            distance: params.distance,
            lat: params.lat,
            lng: params.lng,
            searchTerm: params.searchTerm,
            sortBy: params.sortBy,
            sortOrder: params.sortOrder
        };

        saveFiltersToCookie(cookies, filterData);
    }

    return result;
}

// Keep the original export for backward compatibility
export { fetchEvents };
