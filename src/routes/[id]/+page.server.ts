import { db } from '$lib/server/db';
import { events } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load = (async ({ params }) => {
    const eventId = parseInt(params.id, 10);

    if (isNaN(eventId)) {
        throw error(404, 'Event not found');
    }

    const event = await db.query.events.findFirst({
        where: eq(events.id, eventId)
    });

    if (!event) {
        throw error(404, 'Event not found');
    }

    return { event };
}) satisfies PageServerLoad;

export type UiEvent = Awaited<ReturnType<typeof load>>['event'];