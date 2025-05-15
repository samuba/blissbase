import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull, lte, gt, sql, ilike } from 'drizzle-orm';
import { today as getToday, getLocalTimeZone, parseDate } from '@internationalized/date';
import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { geocodeLocation } from '$lib/common';

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
            geocodedCoords = await geocodeLocation(plzCityParam, GOOGLE_MAPS_API_KEY);
        }

        if (geocodedCoords) {
            const distanceMeters = parseFloat(distanceParam) * 1000;
            // Ensure latitude and longitude columns are not null for the ST_DWithin check
            proximityCondition = sql`ST_DWithin(ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography, ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography, ${distanceMeters}) AND ${eventsTable.latitude} IS NOT NULL AND ${eventsTable.longitude} IS NOT NULL`;
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

    const finalCondition = allConditions.length > 0 ? and(...allConditions) : undefined;

    const eventsQuery = db.query.events.findMany({
        where: finalCondition,
        orderBy: [asc(eventsTable.startAt)],
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

    const paginationData = {
        totalEvents,
        totalPages,
        startDate: startDateParam,
        endDate: endDateParam,
        plzCity: plzCityParam,
        distance: distanceParam,
        lat: latParam ? parseFloat(latParam) : null,
        lng: lngParam ? parseFloat(lngParam) : null,
        page: pageNumber,
        limit: limitNumber,
        searchTerm: searchTermParam
    };

    return { events, pagination: paginationData };
}) satisfies PageServerLoad;


export type UiEvent = Awaited<ReturnType<typeof load>>['events'][number];