import { db } from '$lib/server/db';
import { events } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { trimAllWhitespaces } from '$lib/common';
import { stripHtml } from '$lib/common';

export const load = (async ({ params: { slug } }) => {
    const event = await db.query.events.findFirst({
        where: eq(events.slug, slug)
    });

    if (!event) {
        throw error(404, 'Event not found');
    }

    const descriptionTeaser = trimAllWhitespaces(stripHtml(event.description?.slice(0, 140) ?? '')) + "…"

    return { event, descriptionTeaser };
}) satisfies PageServerLoad;

export type UiEvent = Awaited<ReturnType<typeof load>>['event'];