import { db, s } from '$lib/server/db';

import { asc, count, gte, or, and, lt, isNotNull, lte, gt, sql, ilike, desc } from 'drizzle-orm';
import { today as getToday, parseDate, CalendarDate } from '@internationalized/date';
import { geocodeAddressCached } from '$lib/server/google';
import type { InsertEvent } from '$lib/types';
import { generateSlug } from '$lib/common';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');


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
    const endCalDate = params.endDate ? parseDate(params.endDate) : startCalDate.add({ days: 60 });
    const limit = Math.min(params.limit ?? 10, 20);
    const page = Math.max(params.page ?? 1, 1);
    let sortBy = params.sortBy === 'distance' ? 'distance' : 'time';
    const sortOrder = params.sortOrder === 'desc' ? 'desc' : 'asc';
    const offset = (page - 1) * limit;

    const sixHoursAgo = new Date(new Date().getTime() - 6 * 60 * 60 * 1000);

    let dateCondition;
    try {
        const startDate = startCalDate.toDate(timeZone);
        const endDate = endCalDate.add({ days: 1 }).toDate(timeZone);

        const startsInRange = and(
            gte(s.events.startAt, startDate),
            lte(s.events.startAt, endDate)
        );
        const endsInRange = and(
            lt(s.events.startAt, startDate),
            isNotNull(s.events.endAt),
            gte(s.events.endAt, startDate),
            lte(s.events.endAt, endDate),
            gte(s.events.startAt, sixHoursAgo)
        );
        const spansRange = and(
            lt(s.events.startAt, startDate),
            isNotNull(s.events.endAt),
            gt(s.events.endAt, endDate),
            gte(s.events.startAt, sixHoursAgo)
        );
        dateCondition = or(startsInRange, endsInRange, spansRange);
    } catch (error) {
        console.error('Error parsing date eters:', error);
        const todayDate = getToday(timeZone);
        const todayStart = todayDate.toDate(timeZone);
        const startsTodayOrLater = gte(s.events.startAt, todayStart);
        const acceptableOngoingEvent = and(
            lt(s.events.startAt, todayStart),
            gte(s.events.startAt, sixHoursAgo),
            isNotNull(s.events.endAt),
            gte(s.events.endAt, todayStart),
            lt(s.events.endAt, todayDate.add({ days: 20 }).toDate(timeZone))
        );
        dateCondition = or(startsTodayOrLater, acceptableOngoingEvent);
    }

    let proximityCondition = undefined;
    let geocodedCoords: { lat: number; lng: number } | null = null;

    if (distance) {
        if (lat && lng) {
            if (!isNaN(lat) && !isNaN(lng)) {
                geocodedCoords = { lat, lng };
            } else {
                console.error('Invalid lat/lng eters:', lat, lng);
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

    let orderByClause;
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
            orderByClause = [sql`${distanceSortSql} ASC NULLS LAST`];
        } else {
            orderByClause = [sql`${distanceSortSql} DESC NULLS LAST`];
        }
    } else {
        if (sortOrder === 'asc') {
            orderByClause = [asc(s.events.startAt)];
        } else {
            orderByClause = [desc(s.events.startAt)];
        }
    }

    const allConditions = [dateCondition, proximityCondition].filter(Boolean);

    if (searchTerm && searchTerm.trim() !== '') {
        const searchTermCondition = or(
            ilike(s.events.name, `%${searchTerm}%`),
            sql<boolean>`EXISTS (SELECT 1 FROM unnest(${s.events.tags}) AS t(tag) WHERE t.tag ILIKE ${`%${searchTerm}%`})`,
            ilike(s.events.description, `%${searchTerm}%`)
        );
        if (searchTermCondition) {
            allConditions.push(searchTermCondition);
        }
    }

    const finalCondition = allConditions.length > 0 ? and(...allConditions) : undefined;

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

    return {
        events,
        pagination: {
            startDate: startCalDate.toString(),
            endDate: endCalDate.toString(),
            lat: usedLat,
            lng: usedLng,
            totalEvents,
            totalPages,
            plzCity,
            distance,
            page,
            limit,
            searchTerm,
            sortBy,
            sortOrder
        } satisfies LoadEventsParams & { totalEvents: number, totalPages: number }
    };
}


export async function insertEvent(event: InsertEvent) {
    // trim all strings 
    type EventKey = keyof InsertEvent;
    for (const key in event) {
        if (Object.prototype.hasOwnProperty.call(event, key) && typeof event[key as EventKey] === 'string') {
            (event[key as EventKey] as string) = (event[key as EventKey] as string).trim();
        }
    }

    if (!event.slug) {
        event.slug = generateSlug({
            name: event.name,
            startAt: event.startAt,
            endAt: event.endAt ?? undefined,
        });
    }

    const result = await db.insert(s.events)
        .values(event)
        .onConflictDoUpdate({
            target: s.events.slug,
            set: {
                name: sql`excluded.name`,
                startAt: sql`excluded.start_at`,
                endAt: sql`excluded.end_at`,
                address: sql`excluded.address`,
                price: sql`excluded.price`,
                description: sql`excluded.description`,
                descriptionOriginal: sql`excluded.description_original`,
                summary: sql`excluded.summary`,
                imageUrls: sql`excluded.image_urls`,
                host: sql`excluded.host`,
                hostLink: sql`excluded.host_link`,
                contact: sql`excluded.contact`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                tags: sql`excluded.tags`,
                source: sql`excluded.source`,
                sourceUrl: sql`excluded.source_url`,
                scrapedAt: sql`CURRENT_TIMESTAMP`,
                messageSenderId: sql`excluded.message_sender_id`,
                slug: sql`excluded.slug`,
                soldOut: sql`excluded.sold_out`,
            }
        })
        .returning();

    return result?.[0];
}

type LoadEventsParams = Partial<{
    startDate: string | null; // 2022-01-01
    endDate: string | null; // 2022-01-01
    page?: number | null;
    limit?: number | null;
    plzCity?: string | null;
    distance?: string | null;
    lat?: number | null;
    lng?: number | null;
    searchTerm?: string | null;
    sortBy?: string | null;
    sortOrder?: string | null;
    // these are not used as params but are returned in the pagination object
    totalEvents?: number | null;
    totalPages?: number | null;
}>

export type UiEvent = Awaited<ReturnType<typeof fetchEvents>>['events'][number];