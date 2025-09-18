import { buildConflictUpdateColumns, db, s } from '$lib/server/db';

import { asc, count, gte, or, and, lt, isNotNull, isNull, lte, gt, sql, ilike, desc, SQL } from 'drizzle-orm';
import { today as getToday, parseDate, CalendarDate } from '@internationalized/date';
import { geocodeAddressCached, reverseGeocodeCityCached } from '$lib/server/google';
import type { InsertEvent } from '$lib/types';
import { generateSlug } from '$lib/common';
import * as v from 'valibot';
import { allTagsMap, type TagTranslation } from '$lib/tags';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');


/**
 * Fetches events based on various filtering criteria.
 * 
 * Returns events that match ALL of the following conditions:
 * 
 * 1. **Date Range**: Events that fall within the specified date range 
 *    - Events that start within the range
 *    - Events that end within the range (must have started within last 6 hours for current/future ranges)
 *    - Events that span the entire range (must have started within last 6 hours for current/future ranges)
 *    - Never returns events that started more than 6 hours ago (except for historical date ranges)
 *    - Historical ranges (both startDate and endDate in the past) return all events without time restrictions
 * 
 * 2. **Location Filter** (if distance parameter provided):
 *    - Events within the specified distance (in km) from the given coordinates or geocoded address
 *    - Only events with valid latitude/longitude coordinates are included
 * 
 * 3. **Search Term** (if provided):
 *    - Events where the search term matches the event name, description, or any tag
 *    - Case-insensitive partial matching
 * 
 * 4. **Pagination**: Limited to specified page size (max 20 events per page)
 * 
 * 5. **Sorting**: By time (startAt) or distance from specified location
 * 
 * Events are excluded if they started more than 6 hours ago and don't meet the ongoing event criteria.
 * 
 * @example
 * // Get events in Berlin within 10km, starting next week
 * const events = await fetchEvents({
 *   plzCity: 'Berlin',
 *   distance: '10',
 *   startDate: '2024-01-15',
 *   endDate: '2024-01-22'
 * });
 */
export async function fetchEvents(params: LoadEventsParams) {
    const {
        plzCity,
        distance,
        lat,
        lng,
        searchTerm,
    } = params;
    const timeZone = 'Europe/Berlin';
    const today = getToday(timeZone);
    const startCalDate = params.startDate ? parseDate(params.startDate) : new CalendarDate(today.year, today.month, today.day);
    const endCalDate = params.endDate ? parseDate(params.endDate) : startCalDate.add({ years: 99 });
    const limit = Math.min(params.limit ?? 10, 10);
    const page = Math.max(params.page ?? 1, 1);
    let sortBy = params.sortBy === 'distance' ? 'distance' : 'time';
    const sortOrder = params.sortOrder === 'desc' ? 'desc' : 'asc';
    const offset = (page - 1) * limit;

    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const startDate = startCalDate.toDate(timeZone);
    const endDate = endCalDate.toDate(timeZone);

    // Check if the entire date range is in the past
    const isHistoricalRange = endDate <= now;

    const startsInRange = and(
        gte(s.events.startAt, startDate),
        lte(s.events.startAt, endDate),
        isHistoricalRange ? undefined : or(
            gte(s.events.startAt, sql`NOW()`),   // Future events (haven't started yet)
            and(
                gte(s.events.startAt, sixHoursAgo),   // Recent events (started within last 6 hours)
                or(
                    isNull(s.events.endAt),  // Events without end time
                    gte(s.events.endAt, sql`NOW()`)  // Events that haven't ended yet
                )
            )
        )
    );
    const endsInRange = and(
        isNotNull(s.events.endAt),
        gte(s.events.endAt, startDate),
        lte(s.events.endAt, endDate),
        isHistoricalRange ? undefined : and(
            gte(s.events.startAt, sixHoursAgo),
            gte(s.events.endAt, sql`NOW()`)  // Event hasn't ended yet
        )
    );
    const spansRange = and(
        isNotNull(s.events.endAt),
        lt(s.events.startAt, startDate),
        gt(s.events.endAt, endDate),
        isHistoricalRange ? undefined : and(
            gte(s.events.startAt, sixHoursAgo),
            gte(s.events.endAt, sql`NOW()`)  // Event hasn't ended yet
        )
    );
    const dateCondition = or(startsInRange, endsInRange, spansRange);


    let proximityCondition: SQL<boolean> | undefined = undefined;
    let geocodedCoords: { lat: number; lng: number } | null = null;

    if (distance) {
        if (lat && lng) {
            if (!isNaN(lat) && !isNaN(lng)) {
                geocodedCoords = { lat, lng };
            } else {
                console.error('Invalid lat/lng parameters:', lat, lng);
            }
        } else if (plzCity && plzCity.trim() !== '') {
            geocodedCoords = await geocodeAddressCached([plzCity], GOOGLE_MAPS_API_KEY);
        }

        if (geocodedCoords) {
            const distanceMeters = parseFloat(distance) * 1000;
            proximityCondition = sql`ST_DWithin(ST_SetSRID(ST_MakePoint(${s.events.longitude}, ${s.events.latitude}), 4326)::geography, ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography, ${distanceMeters}) AND ${s.events.latitude} IS NOT NULL AND ${s.events.longitude} IS NOT NULL`;
        }
    }


    if (sortBy === 'distance' && !geocodedCoords) {
        sortBy = 'time';
    }

    let orderByClause; // also sorting by event.id cuz if events have same startAt, svelte hydration can mix them up and we have mismatched images
    if (sortBy === 'distance' && geocodedCoords) {
        const distanceSortSql = sql`
            CASE
                WHEN ${s.events.longitude} IS NOT NULL AND ${s.events.latitude} IS NOT NULL THEN
                    ST_Distance(
                        ST_SetSRID(ST_MakePoint(${s.events.longitude}, ${s.events.latitude}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography
                    )
                ELSE NULL
            END`;
        if (sortOrder === 'asc') {
            orderByClause = [sql`${distanceSortSql} ASC NULLS LAST`, asc(s.events.id)];
        } else {
            orderByClause = [sql`${distanceSortSql} DESC NULLS LAST`, asc(s.events.id)];
        }
    } else {
        if (sortOrder === 'asc') {
            orderByClause = [asc(s.events.startAt), asc(s.events.id)];
        } else {
            orderByClause = [desc(s.events.startAt), asc(s.events.id)];
        }
    }

    const allConditions = [dateCondition, proximityCondition, and(s.events.listed)];

    if (searchTerm && searchTerm.trim() !== '') {
        const searchTermCondition = or(
            ilike(s.events.name, `%${searchTerm}%`),
            sql<boolean>`EXISTS (SELECT 1 FROM unnest(${s.events.tags}) AS t(tag) WHERE t.tag ILIKE ${`%${searchTerm}%`})`,
            ilike(s.events.description, `%${searchTerm}%`)
        );
        allConditions.push(searchTermCondition);
    }

    const finalCondition = and(...allConditions.filter(Boolean));

    const eventsQuery = db.query.events.findMany({
        where: finalCondition,
        orderBy: orderByClause,
        limit: limit,
        offset: offset,
        extras: {
            distanceKm: geocodedCoords ? sql<number | null>`
            CASE
                WHEN ${s.events.longitude} IS NOT NULL AND ${s.events.latitude} IS NOT NULL THEN
                    GREATEST(1, ROUND(ST_Distance(
                        ST_SetSRID(ST_MakePoint(${s.events.longitude}, ${s.events.latitude}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography
                    ) / 1000))
                ELSE NULL
            END
        `.as('distance_km') : sql<null>`NULL`.as('distance_km')
        }
    });

    const totalEventsQuery = db.select({ count: count() }).from(s.events).where(finalCondition);

    const startTime = performance.now();
    const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);
    const endTime = performance.now();
    console.log(`Query execution time: ${endTime - startTime}ms`);

    const totalEvents = totalResult[0].count;
    const totalPages = Math.ceil(totalEvents / limit);

    const usedLat = geocodedCoords ? geocodedCoords.lat : lat;
    const usedLng = geocodedCoords ? geocodedCoords.lng : lng;

    // Resolve city name from coordinates if using current location
    let resolvedCityName: string | null = null;
    if (lat && lng && !plzCity) {
        // Only resolve city name when using coordinates directly (not when plzCity was provided)
        resolvedCityName = await reverseGeocodeCityCached(lat, lng, GOOGLE_MAPS_API_KEY);
    }

    return {
        events: prepareEventsForUi(events),
        pagination: {
            startDate: params.startDate ? startCalDate.toString() : undefined,
            endDate: params.endDate ? endCalDate.toString() : undefined,
            lat: usedLat,
            lng: usedLng,
            totalEvents,
            totalPages,
            plzCity: resolvedCityName || plzCity,
            distance,
            page,
            limit,
            searchTerm,
            sortBy,
            sortOrder
        } satisfies LoadEventsParams & { totalEvents: number, totalPages: number }
    };
}

type StringOrTagTranslation = string & TagTranslation;
const ASI_ROOMS = ['asi_de_at_ch', 'asi_regio_at_by', 'asi_regio_nord', 'asi_regio_ost', 'asi_regio_sw', 'asi_regio_west'];
export function prepareEventsForUi<T extends { tags?: string[] | null; telegramRoomIds?: string[] | null }>(events: T[]):
    Array<Simplify<Omit<T, 'hostSecret'> & { tags?: StringOrTagTranslation[]; hostSecret: undefined }>> {
    return events
        // filter ASI rooms
        // .filter(event => {
        //     const ASI_ROOMS = ['asi_de_at_ch', 'asi_regio_at_by', 'asi_regio_nord', 'asi_regio_ost', 'asi_regio_sw', 'asi_regio_west'];
        //     if (event.telegramRoomIds?.every(roomId => ASI_ROOMS.includes(roomId))) {
        //         return false;
        //     }
        //     return true;
        // })
        .map(event => ({
            ...event,
            tags: event.tags?.map(x => allTagsMap.get(x) ?? x) as StringOrTagTranslation[],
            hostSecret: undefined, // never leak this to the ui
        }));
}

export async function insertEvents(events: InsertEvent[]) {
    const processedEvents = events.map(event => {
        // trim all strings 
        type EventKey = keyof InsertEvent;
        for (const key in event) {
            if (Object.prototype.hasOwnProperty.call(event, key) && typeof event[key as EventKey] === 'string') {
                (event[key as EventKey] as string) = (event[key as EventKey] as string).trim();
            }
        }

        event.slug = generateSlug({
            name: event.name,
            startAt: event.startAt,
            endAt: event.endAt ?? undefined,
        });

        return event;
    });

    const result = await db.insert(s.events)
        .values(processedEvents)
        .onConflictDoUpdate({
            target: s.events.slug,
            set: buildConflictUpdateColumns(s.events, ['slug', 'id', 'createdAt'])
        })
        .returning();

    return result;
}

export const loadEventsParamsSchema = v.partial(v.object({
    startDate: v.nullable(v.string()), // 2022-01-01
    endDate: v.nullable(v.string()), // 2022-01-01
    page: v.nullable(v.number()),
    limit: v.nullable(v.number()),
    plzCity: v.nullable(v.string()),
    distance: v.nullable(v.string()),
    lat: v.nullable(v.number()),
    lng: v.nullable(v.number()),
    searchTerm: v.nullable(v.string()),
    sortBy: v.nullable(v.string()),
    sortOrder: v.nullable(v.string()),
    // these are not used as params but are returned in the pagination object
    totalEvents: v.nullable(v.number()),
    totalPages: v.nullable(v.number()),
}));

type LoadEventsParams = v.InferInput<typeof loadEventsParamsSchema>;

export type UiEvent = Awaited<ReturnType<typeof fetchEvents>>['events'][number];