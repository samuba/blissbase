import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull } from 'drizzle-orm';
import { today as getToday, getLocalTimeZone } from '@internationalized/date';

export const load = (async ({ url }) => {
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const limit = parseInt(url.searchParams.get('limit') ?? '10');
    const offset = (page - 1) * limit;

    const timeZone = getLocalTimeZone();
    const todayDate = getToday(timeZone);
    const todayStart = todayDate.toDate(timeZone);

    const startsTodayOrLater = gte(eventsTable.startAt, todayStart);

    // Event has already started but ends today or later, with end date within 20 days
    const acceptableOngoingEvent = and(
        lt(eventsTable.startAt, todayStart),
        isNotNull(eventsTable.endAt),
        gte(eventsTable.endAt, todayStart),
        lt(eventsTable.endAt, todayDate.add({ days: 20 }).toDate(timeZone))
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