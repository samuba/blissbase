import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull, lte, gt, sql } from 'drizzle-orm';
import { today as getToday, getLocalTimeZone, parseDate } from '@internationalized/date';
import { GOOGLE_MAPS_API_KEY } from '$env/static/private';



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
                lte(eventsTable.endAt, endDate)
            );
            const spansRange = and(
                lt(eventsTable.startAt, startDate),
                isNotNull(eventsTable.endAt),
                gt(eventsTable.endAt, endDate)
            );
            dateCondition = or(startsInRange, endsInRange, spansRange);
        } catch (error) {
            console.error('Error parsing date parameters:', error);
            const todayDate = getToday(timeZone);
            const todayStart = todayDate.toDate(timeZone);
            const startsTodayOrLater = gte(eventsTable.startAt, todayStart);
            const acceptableOngoingEvent = and(
                lt(eventsTable.startAt, todayStart),
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
            geocodedCoords = await geocodeLocation(plzCityParam);
        }

        if (geocodedCoords) {
            const distanceMeters = parseFloat(distanceParam) * 1000;
            // Ensure latitude and longitude columns are not null for the ST_DWithin check
            proximityCondition = sql`ST_DWithin(ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography, ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography, ${distanceMeters}) AND ${eventsTable.latitude} IS NOT NULL AND ${eventsTable.longitude} IS NOT NULL`;
        }
    }

    const allConditions = [dateCondition, proximityCondition].filter(Boolean);
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
                    ROUND(ST_Distance(
                        ST_SetSRID(ST_MakePoint(${eventsTable.longitude}, ${eventsTable.latitude}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${geocodedCoords.lng}, ${geocodedCoords.lat}), 4326)::geography
                    ) / 1000)
                ELSE NULL
            END
        `.as('distance_km') : sql<null>`NULL`.as('distance_km')
        }
    });

    const totalEventsQuery = db.select({ count: count() }).from(eventsTable).where(finalCondition);

    const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);

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
        limit: limitNumber
    };

    return { events, pagination: paginationData };
}) satisfies PageServerLoad;

// Helper function to calculate distance using Haversine formula (approximates on a sphere)
// This is a simplified version. For accurate geospatial queries, PostGIS ST_DWithin is preferred.
// However, if PostGIS is not available, this can be used to filter after a broader DB query.
// For direct DB filtering, we will use a raw SQL query with ST_DWithin assuming PostGIS.

async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
    if (!GOOGLE_MAPS_API_KEY) {
        console.error('Google Maps API key is not set. Skipping geocoding.');
        return null;
    }
    try {
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_MAPS_API_KEY}&language=de&region=DE`
        );
        if (!response.ok) {
            console.error(`Geocoding API request failed with status: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (data.status === 'OK' && data.results && data.results.length > 0) {
            return data.results[0].geometry.location; // { lat, lng }
        } else {
            console.error('Geocoding failed or no results:', data.status, data.error_message);
            return null;
        }
    } catch (error) {
        console.error('Error during geocoding:', error);
        return null;
    }
}

export type UiEvent = Awaited<ReturnType<typeof load>>['events'][number];