import { fetchEvents, loadEventsParamsSchema } from "$lib/server/events";
import { loadFiltersFromCookie, saveFiltersToCookie } from "$lib/cookie-utils";
import { getRequestEvent, command, query } from '$app/server';
import * as v from 'valibot';
import { db, eq, s, sql } from "./server/db";
import { error } from "@sveltejs/kit";
import { isAdminSession } from "./server/admin";

// using `command` instead of `query` cuz query does not allow setting cookies
export const fetchEventsWithCookiePersistence = command(loadEventsParamsSchema, async (params) => {
    const { cookies } = getRequestEvent();

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

    nothing().refresh()

    return result;
});

export const nothing = query(async () => {
    // no-op to be used with `command.updates(nothing)` to force svelte to not reload queries
    // can be removed when this is implemented: https://github.com/sveltejs/kit/issues/14079
})

const updateEventSchema = v.object({
    event: v.pipe(
        v.object({
            id: v.number(),
            name: v.string(),
            price: v.nullish(v.string()),
            startAt: v.date(),
            endAt: v.nullish(v.date()),
            address: v.string(),
            description: v.string(),
            listed: v.boolean(),
            soldOut: v.boolean(),
            host: v.nullish(v.string()),
            hostLink: v.nullish(v.string()),
            sourceUrl: v.nullish(v.string()),
            tags: v.array(v.string()),
        }),
        v.transform((data) => {
            const { address, ...result } = data;

            // split address into array
            const addressLines = address.split(/[,\n]/).map(x => x.trim()).filter((x) => !!x);

            // trim all strings and set empty strings to null
            for (const [key, value] of Object.entries(result)) {
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    (result as Record<string, unknown>)[key] = trimmed === '' ? null : trimmed;
                }
            }
            return { ...result, address: addressLines };
        }),
        v.check((data) => {
            if (data.endAt && data.endAt <= data.startAt) {
                return false;
            }
            return true;
        }, "End time must be after start time")
    ),
    hostSecret: v.string(),
});

export const updateEvent = command(updateEventSchema, async (params) => {
    console.log({ params })
    const event = await db.query.events.findFirst({ where: eq(s.events.id, params.event.id) });
    if (!event) error(404, "Event not found");
    if (!await isAdminSession() && params.hostSecret !== event.hostSecret) error(403, "Invalid host secret");

    const { id, ...eventWithoutId } = params.event;
    await db.update(s.events).set({
        ...eventWithoutId,
        updatedAt: sql`now()`
    }).where(eq(s.events.id, event.id));
})