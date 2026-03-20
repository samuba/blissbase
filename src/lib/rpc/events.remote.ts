import { fetchEvents, loadEventsParamsSchema, prepareEventsResultForUi } from "$lib/server/events";
import { loadFiltersFromCookie, saveFiltersToCookie } from "$lib/cookie-utils";
import { getRequestEvent, command, query } from '$app/server';
import { ensureUserId, posthogCapture } from "$lib/server/common";
import { db, s } from '$lib/server/db';
import { and, asc, desc, eq, lt, gte, sql } from 'drizzle-orm';
import { eventWith, prepareEventsForUi } from '$lib/server/events';

// using `command` instead of `query` cuz query does not allow setting cookies
export const fetchEventsWithCookiePersistence = command(loadEventsParamsSchema, async (params) => {
    const { cookies } = getRequestEvent();

    if (!cookies) {
        // Fallback to regular fetchEvents if no cookies context
        return prepareEventsResultForUi(await fetchEvents(params));
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
        params.sortOrder !== savedFilters.sortOrder ||
        JSON.stringify(params.tagIds) !== JSON.stringify(savedFilters.tagIds) ||
        params.attendanceMode !== savedFilters.attendanceMode
    ) : true;

    // Fetch events with current params
    const result = prepareEventsResultForUi(await fetchEvents(params));

    posthogCapture('events_fetched', {
        events: result.events.length,
        totalEvents: result.pagination.totalEvents,
        totalPages: result.pagination.totalPages,
        lat: result.pagination.lat,
        lng: result.pagination.lng,
        plzCity: result.pagination.plzCity,
        distance: result.pagination.distance,
        searchTerm: result.pagination.searchTerm,
        sortBy: result.pagination.sortBy,
        sortOrder: result.pagination.sortOrder,
        tagIds: result.pagination.tagIds,
        attendanceMode: result.pagination.attendanceMode
    })

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
            sortOrder: params.sortOrder,
            tagIds: params.tagIds,
            attendanceMode: params.attendanceMode
        };

        saveFiltersToCookie(cookies, filterData);
    }

    nothing().refresh()

    return result;
});

export const nothing = query(async () => {
    // no-op to be used with `command.updates(nothing)` to force svelte to not reload queries
    // can be removed when this is implemented: https://github.com/sveltejs/kit/issues/14079
})

export const getMyAuthoredUpcomingEvents = query(async () => {
	const userId = ensureUserId();

	const endsAtOrDefault = sql<Date>`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;

	const events = await db.query.events.findMany({
		where: and(
			eq(s.events.authorId, userId),
			gte(endsAtOrDefault, sql`NOW()`)
		),
		with: eventWith,
		orderBy: [asc(s.events.startAt), asc(s.events.id)],
	});

	return prepareEventsForUi(events);
});

export const getMyAuthoredPastEvents = query(async () => {
	const userId = ensureUserId();

	const endsAtOrDefault = sql<Date>`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;

	const events = await db.query.events.findMany({
		where: and(
			eq(s.events.authorId, userId),
			lt(endsAtOrDefault, sql`NOW()`)
		),
		with: eventWith,
		orderBy: [desc(s.events.startAt), desc(s.events.id)],
	});

	return prepareEventsForUi(events);
});
