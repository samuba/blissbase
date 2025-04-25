import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull } from 'drizzle-orm';

export const load = (async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const limit = parseInt(url.searchParams.get('limit') ?? '10');
    const offset = (page - 1) * limit;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to the beginning of the day

    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 40);

    // Three cases to include:
    // 1. Event starts today or later
    const startsTodayOrLater = gte(eventsTable.startAt, today);

    // 2. Event has already started but ends today or later, with end date within 40 days
    const acceptableOngoingEvent = and(
        lt(eventsTable.startAt, today),
        isNotNull(eventsTable.endAt),
        gte(eventsTable.endAt, today),
        lt(eventsTable.endAt, futureDate)
    );

    const finalCondition = or(
        startsTodayOrLater,
        acceptableOngoingEvent,
    );

    const eventsQuery = db.query.events.findMany({
        where: finalCondition,
        orderBy: [asc(eventsTable.startAt)],
        limit: limit > 20 ? 20 : limit,
        offset: offset
    });

    const totalEventsQuery = db
        .select({ count: count() })
        .from(eventsTable)
        .where(finalCondition);

    const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);

    const totalEvents = totalResult[0].count;
    const totalPages = Math.ceil(totalEvents / limit);

    return { events, page, limit, totalEvents, totalPages };
}) satisfies PageServerLoad;