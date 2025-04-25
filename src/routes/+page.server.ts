import { db } from '../lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull, isNull } from 'drizzle-orm';

export const load = (async ({ url }) => {
    // const page = parseInt(url.searchParams.get('page') ?? '1');
    // const limit = parseInt(url.searchParams.get('limit') ?? '10');
    // const offset = (page - 1) * limit;

    // const today = new Date();
    // today.setHours(0, 0, 0, 0); // Set to the beginning of the day
    // const todayIsoString = today.toISOString();

    // const futureDate = new Date(today);
    // futureDate.setDate(today.getDate() + 40);
    // const futureDateIsoString = futureDate.toISOString();

    // // Three cases to include:
    // // 1. Event starts today or later
    // const startsTodayOrLater = gte(eventsTable.startAt, todayIsoString);

    // // 2. Event has already started but ends today or later, with end date within 40 days
    // const acceptableOngoingEvent = and(
    //     lt(eventsTable.startAt, todayIsoString),
    //     isNotNull(eventsTable.endAt),
    //     gte(eventsTable.endAt, todayIsoString),
    //     lt(eventsTable.endAt, futureDateIsoString)
    // );

    // // 3. Event has already started and has no end date (endAt is NULL)
    // const ongoingEventWithNoEndDate = and(
    //     lt(eventsTable.startAt, todayIsoString),
    //     isNull(eventsTable.endAt)
    // );

    // // Combine all acceptable conditions with OR
    // const finalCondition = or(
    //     startsTodayOrLater,
    //     acceptableOngoingEvent,
    //     ongoingEventWithNoEndDate
    // );

    // const eventsQuery = db.query.events.findMany({
    //     where: finalCondition,
    //     orderBy: [asc(eventsTable.startAt)],
    //     limit: limit > 20 ? 20 : limit,
    //     offset: offset
    // });

    // const totalEventsQuery = db
    //     .select({ count: count() })
    //     .from(eventsTable)
    //     .where(finalCondition);

    // const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);

    // const totalEvents = totalResult[0].count;
    // const totalPages = Math.ceil(totalEvents / limit);

    // Fake values for development/testing
    const events = [
        {
            id: 1,
            name: 'Yoga Retreat',
            startAt: new Date().toISOString(),
            endAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            address: ['123 Zen Street', 'Berlin, Germany'],
            price: '€200',
            description: 'A weekend of relaxation and mindfulness',
            imageUrls: ['https://example.com/yoga1.jpg'],
            host: 'Tribehaus',
            permalink: 'yoga-retreat-1'
        },
        {
            id: 2,
            name: 'Sound Healing Workshop',
            startAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            address: ['456 Harmony Road', 'Munich, Germany'],
            price: '€50',
            description: 'Experience the healing power of sound',
            imageUrls: ['https://example.com/sound1.jpg'],
            host: 'Heilnetz',
            permalink: 'sound-healing-2'
        },
        {
            id: 3,
            name: 'Meditation Circle',
            startAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            endAt: null,
            address: ['789 Peace Lane', 'Hamburg, Germany'],
            price: 'Free',
            description: 'Weekly meditation sessions for inner peace',
            imageUrls: ['https://example.com/meditation1.jpg'],
            host: 'Awara',
            permalink: 'meditation-circle-3'
        }
    ];

    const page = 1;
    const limit = 10;
    const totalEvents = 3;
    const totalPages = 1;

    return { events, page, limit, totalEvents, totalPages };
}) satisfies PageServerLoad;