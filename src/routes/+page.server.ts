import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { events as eventsTable } from '../lib/server/schema';
import { asc, count, gte, or, and, lt, isNotNull, lte, gt } from 'drizzle-orm';
import { today as getToday, getLocalTimeZone, parseDate } from '@internationalized/date';

export const load = (async ({ url }) => {
    // Get params as string | null
    const pageParam = url.searchParams.get('page');
    const limitParam = url.searchParams.get('limit');
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    // Parse params with defaults for internal use
    const pageNumber = parseInt(pageParam ?? '1', 10);
    let limitNumber = parseInt(limitParam ?? '10', 10);

    // Ensure limitNumber is valid and within bounds (e.g., max 20)
    if (isNaN(limitNumber) || limitNumber <= 0) {
        limitNumber = 10; // Default limit
    }
    limitNumber = Math.min(limitNumber, 20); // Apply max limit

    // Ensure pageNumber is valid
    const page = isNaN(pageNumber) || pageNumber < 1 ? 1 : pageNumber;

    const offset = (page - 1) * limitNumber;

    const timeZone = getLocalTimeZone();

    let finalCondition;

    if (startDateParam && endDateParam) {
        try {
            const startCalDate = parseDate(startDateParam);
            const endCalDate = parseDate(endDateParam);
            const startDate = startCalDate.toDate(timeZone);
            const endDate = endCalDate.add({ days: 1 }).toDate(timeZone);

            // Events starting within the selected range
            const startsInRange = and(
                gte(eventsTable.startAt, startDate),
                lte(eventsTable.startAt, endDate)
            );

            // Events ending within the selected range (for multi-day events starting before the range)
            const endsInRange = and(
                lt(eventsTable.startAt, startDate),
                isNotNull(eventsTable.endAt),
                gte(eventsTable.endAt, startDate),
                lte(eventsTable.endAt, endDate)
            );

            // Events that span the entire selected range
            const spansRange = and(
                lt(eventsTable.startAt, startDate),
                isNotNull(eventsTable.endAt),
                gt(eventsTable.endAt, endDate)
            );

            finalCondition = or(startsInRange, endsInRange, spansRange);

        } catch (error) {
            console.error("Error parsing date parameters:", error);
            // Fallback to default condition if parsing fails
            const todayDate = getToday(timeZone);
            const todayStart = todayDate.toDate(timeZone);
            const startsTodayOrLater = gte(eventsTable.startAt, todayStart);
            const acceptableOngoingEvent = and(
                lt(eventsTable.startAt, todayStart),
                isNotNull(eventsTable.endAt),
                gte(eventsTable.endAt, todayStart),
                lt(eventsTable.endAt, todayDate.add({ days: 20 }).toDate(timeZone))
            );
            finalCondition = or(startsTodayOrLater, acceptableOngoingEvent);
        }

    } else {
        // Default condition if no time range is provided
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
        finalCondition = or(startsTodayOrLater, acceptableOngoingEvent);
    }

    const eventsQuery = db.query.events.findMany({
        where: finalCondition,
        orderBy: [asc(eventsTable.startAt)],
        limit: limitNumber, // Use parsed limitNumber
        offset: offset
    });

    const totalEventsQuery = db
        .select({ count: count() })
        .from(eventsTable)
        .where(finalCondition);

    const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);

    const totalEvents = totalResult[0].count;
    const totalPages = Math.ceil(totalEvents / limitNumber); // Use parsed limitNumber

    const pagination = {
        totalEvents,
        totalPages,
        startDate: startDateParam,
        endDate: endDateParam,
        page: pageNumber,
        limit: limitNumber
    };

    return { events, pagination };
}) satisfies PageServerLoad;

