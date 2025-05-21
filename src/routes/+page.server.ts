import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull, lte, gt, sql, ilike, desc, eq } from 'drizzle-orm';
import { today as getToday, getLocalTimeZone, parseDate } from '@internationalized/date';
import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { geocodeAddressCached } from '$lib/server/google';

export const load = (async ({ url }) => {
    // Get params as string | null
    const pageParam = url.searchParams.get('page');
    const limitParam = url.searchParams.get('limit');
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');
    const plzCityParam = url.searchParams.get('plzCity');
    const distanceParam = url.searchParams.get('distance'); // in km
    const latParam = url.searchParams.get('lat');
    const lngParam = url.searchParams.get('lng');
    const searchTermParam = url.searchParams.get('searchTerm');
    const sortByParam = url.searchParams.get('sortBy');
    const sortOrderParam = url.searchParams.get('sortOrder');

    // Parse params with defaults for internal use
    const pageNumber = parseInt(pageParam ?? '1', 10);
    let limitNumber = parseInt(limitParam ?? '10', 10);

    if (isNaN(limitNumber) || limitNumber <= 0) {
        limitNumber = 10;
    }
    limitNumber = Math.min(limitNumber, 20);

    const page = isNaN(pageNumber) || pageNumber < 1 ? 1 : pageNumber;
    const offset = (page - 1) * limitNumber;
    const timeZone = getLocalTimeZone();
    const sixHoursAgo = new Date(new Date().getTime() - 6 * 60 * 60 * 1000);

    let dateCondition;

    if (startDateParam && endDateParam) {
        try {
            const startCalDate = parseDate(startDateParam);
            const endCalDate = parseDate(endDateParam);
            const startDate = startCalDate.toDate(timeZone);
            const endDate = endCalDate.add({ days: 1 }).toDate(timeZone);

            const startsInRange = and(
                gte(eventsTable.startAt, startDate),
                lte(eventsTable.startAt, endDate)
            );
            const endsInRange = and(
                lt(eventsTable.startAt, startDate),
                isNotNull(eventsTable.endAt),
                gte(eventsTable.endAt, startDate),
                lte(eventsTable.endAt, endDate),
                gte(eventsTable.startAt, sixHoursAgo) // Only include events that started within the last 6 hours
            );
            const spansRange = and(
                lt(eventsTable.startAt, startDate),
                isNotNull(eventsTable.endAt),
                gt(eventsTable.endAt, endDate),
                gte(eventsTable.startAt, sixHoursAgo) // Only include events that started within the last 6 hours
            );
            dateCondition = or(startsInRange, endsInRange, spansRange);
        } catch (error) {
            console.error('Error parsing date parameters:', error);
            const todayDate = getToday(timeZone);
            const todayStart = todayDate.toDate(timeZone);
            const startsTodayOrLater = gte(eventsTable.startAt, todayStart);
            const acceptableOngoingEvent = and(
                lt(eventsTable.startAt, todayStart),
                gte(eventsTable.startAt, sixHoursAgo), // Only include events that started within the last 6 hours
                isNotNull(eventsTable.endAt),
                gte(eventsTable.endAt, todayStart),
                lt(eventsTable.endAt, todayDate.add({ days: 20 }).toDate(timeZone))
            );
            dateCondition = or(startsTodayOrLater, acceptableOngoingEvent);
        }
    } else {
        const todayDate = getToday(timeZone);
        const todayStart = todayDate.toDate(timeZone);
        const startsTodayOrLater = gte(eventsTable.startAt, todayStart);
        const acceptableOngoingEvent = and(
            lt(eventsTable.startAt, todayStart),
            gte(eventsTable.startAt, sixHoursAgo), // Only include events that started within the last 12 hours
            isNotNull(eventsTable.endAt),
            gte(eventsTable.endAt, todayStart),
            lt(eventsTable.endAt, todayDate.add({ days: 20 }).toDate(timeZone))
        );
        dateCondition = or(startsTodayOrLater, acceptableOngoingEvent);
    }

    let proximityCondition = undefined;
    let geocodedCoords: { lat: number; lng: number } | null = null;

    if (distanceParam) {
        if (latParam && lngParam) {
            const lat = parseFloat(latParam);
            const lng = parseFloat(lngParam);
            if (!isNaN(lat) && !isNaN(lng)) {
                geocodedCoords = { lat, lng };
            } else {
                console.error('Invalid lat/lng parameters:', latParam, lngParam);
            }
        } else if (plzCityParam && plzCityParam.trim() !== '') {
            // Only geocode if plzCityParam is provided and not empty, and lat/lng are not present
            geocodedCoords = await geocodeAddressCached([plzCityParam], GOOGLE_MAPS_API_KEY);
        }

        if (geocodedCoords) {
            const distanceMeters = parseFloat(distanceParam) * 1000;
            // Ensure latitude and longitude columns are not null for the ST_DWithin check
            proximityCondition = sql`ST_DWithin(ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography, ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography, ${distanceMeters}) AND ${eventsTable.latitude} IS NOT NULL AND ${eventsTable.longitude} IS NOT NULL`;
        }
    }

    // Parse sort params
    let sortBy = sortByParam === 'distance' ? 'distance' : 'time'; // Default to 'time'
    const sortOrder = sortOrderParam === 'desc' ? 'desc' : 'asc';   // Default to 'asc'

    // If trying to sort by distance but no geocoded coords are available (e.g. no location provided for search), fallback to time sort.
    if (sortBy === 'distance' && !geocodedCoords) {
        sortBy = 'time';
    }

    let orderByClause;
    if (sortBy === 'distance' && geocodedCoords) {
        // Using the ST_Distance directly as previously defined in extras for sorting to ensure consistency.
        // This SQL expression calculates distance or returns NULL if event lat/lng is missing.
        const distanceSortSql = sql`
            CASE
                WHEN ${eventsTable.longitude} IS NOT NULL AND ${eventsTable.latitude} IS NOT NULL THEN
                    ST_Distance(
                        ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography
                    )
                ELSE NULL
            END`;
        if (sortOrder === 'asc') {
            orderByClause = [sql`${distanceSortSql} ASC NULLS LAST`];
        } else {
            orderByClause = [sql`${distanceSortSql} DESC NULLS LAST`];
        }
    } else { // Default to time sort or if distance sort is not possible
        if (sortOrder === 'asc') {
            orderByClause = [asc(eventsTable.startAt)];
        } else {
            orderByClause = [desc(eventsTable.startAt)];
        }
    }

    const allConditions = [dateCondition, proximityCondition].filter(Boolean);

    if (searchTermParam && searchTermParam.trim() !== '') {
        const searchTermCondition = or(
            ilike(eventsTable.name, `%${searchTermParam}%`),
            // Check if any element in the tags array contains the search term (case-insensitive)
            // This requires converting the array to a string or using a specific PostgreSQL array function.
            // For simplicity and broader compatibility, we can check if the search term is a substring of any tag.
            // A more robust solution might involve unnesting or specific array operators if performance is critical.
            sql<boolean>`EXISTS (SELECT 1 FROM unnest(${eventsTable.tags}) AS t(tag) WHERE t.tag ILIKE ${`%${searchTermParam}%`})`,
            ilike(eventsTable.description, `%${searchTermParam}%`)
        );
        if (searchTermCondition) { // Ensure it's not undefined if searchTermParam was just spaces
            allConditions.push(searchTermCondition);
        }
    }

    allConditions.push(eq(eventsTable.source, 'telegram'))

    const finalCondition = allConditions.length > 0 ? and(...allConditions) : undefined;

    const eventsQuery = db.query.events.findMany({
        where: finalCondition,
        orderBy: orderByClause,
        limit: limitNumber,
        offset: offset,
        extras: {
            distanceKm: geocodedCoords ? sql<number | null>`
            CASE
                WHEN ${eventsTable.longitude} IS NOT NULL AND ${eventsTable.latitude} IS NOT NULL THEN
                    GREATEST(1, ROUND(ST_Distance(
                        ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography
                    ) / 1000))
                ELSE NULL
            END
        `.as('distance_km') : sql<null>`NULL`.as('distance_km')
        }
    });

    const totalEventsQuery = db.select({ count: count() }).from(eventsTable).where(finalCondition);

    const startTime = performance.now();
    const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);
    const endTime = performance.now();
    console.log(`Query execution time: ${endTime - startTime}ms`);

    const totalEvents = totalResult[0].count;
    const totalPages = Math.ceil(totalEvents / limitNumber);

    const usedLat = geocodedCoords ? geocodedCoords.lat : (latParam ? parseFloat(latParam) : null);
    const usedLng = geocodedCoords ? geocodedCoords.lng : (lngParam ? parseFloat(lngParam) : null);

    const paginationData = {
        totalEvents,
        totalPages,
        startDate: startDateParam,
        endDate: endDateParam,
        plzCity: plzCityParam,
        distance: distanceParam,
        lat: usedLat,
        lng: usedLng,
        page: pageNumber,
        limit: limitNumber,
        searchTerm: searchTermParam,
        sortBy: sortBy,
        sortOrder: sortOrder
    };

    return { events, pagination: paginationData };
}) satisfies PageServerLoad;


export type UiEvent = Awaited<ReturnType<typeof load>>['events'][number];