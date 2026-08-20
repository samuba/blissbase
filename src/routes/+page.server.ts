import { fetchEvents, prepareEventsResultForUi, type LoadEventsParams } from "$lib/server/events";
import type { PageServerLoad } from "./$types";
import { loadFiltersFromCookie, LOCATION_INTERACTED_COOKIE_NAME, saveFiltersToCookie } from "$lib/cookie-utils";
import { coarseLatLngForAnalytics } from "$lib/locationFilter";
import { posthogCapture } from "$lib/server/common";
import { getEventSourceFilter, getEventSources } from "$lib/rpc/admin.remote";

export const load = (async ({ cookies, locals }) => {
    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);
    const userAlreadySetLocation = Boolean(cookies.get(LOCATION_INTERACTED_COOKIE_NAME));

    // Merge saved filters with default parameters
    const defaultParams = {
        page: 1,
        limit: 8
    };

    let params: LoadEventsParams = savedFilters ? { ...defaultParams, ...savedFilters } : defaultParams;
    // Source filter is admin-only; ignore cookie value for non-admins
    params = {
        ...params,
        source: locals.isAdminSession ? (params.source?.trim() || null) : null,
    };
    const hasSavedLocation = Boolean(
        savedFilters?.plzCity?.trim() ||
        (savedFilters?.lat != null && savedFilters?.lng != null)
    );

    let autoDetectedCity: string | null = null;
    if (!hasSavedLocation && !userAlreadySetLocation && locals.requestInfo?.city) {
        let decodedCity = locals.requestInfo.city.trim() + ", " + locals.requestInfo.country;
        try {
            decodedCity = decodeURIComponent(decodedCity).trim();
        } catch {
            // keep original city string if header is not URI-encoded
        }
        if (decodedCity) {
            autoDetectedCity = decodedCity;
            params = { ...params, plzCity: decodedCity, distance: '50' };
        }
    }

    const { events, pagination } = prepareEventsResultForUi(await fetchEvents(params));

    saveFiltersToCookie(cookies, {
        ...(savedFilters ?? {}),
        plzCity: pagination.plzCity,
        distance: pagination.distance,
        lat: pagination.lat,
        lng: pagination.lng,
        source: locals.isAdminSession ? (pagination.source ?? null) : (savedFilters?.source ?? null),
    });

    const [eventSources, eventSourceFilter] = locals.isAdminSession
        ? await Promise.all([getEventSources(), getEventSourceFilter()])
        : [null, null];
    const coarseCoords = coarseLatLngForAnalytics({ lat: pagination.lat, lng: pagination.lng });
    posthogCapture('events_fetched', {
        events: events.length,
        totalEvents: pagination.totalEvents,
        totalPages: pagination.totalPages,
        ...coarseCoords,
        plzCity: pagination.plzCity,
        distance: pagination.distance,
        searchTerm: pagination.searchTerm,
        sortBy: pagination.sortBy,
        sortOrder: pagination.sortOrder,
        categorySlugs: pagination.categorySlugs,
        attendanceMode: pagination.attendanceMode
    })

    return {
        events,
        pagination,
        savedFilters,
        autoDetectedCity,
        eventSources,
        eventSourceFilter,
    };
}) satisfies PageServerLoad;
