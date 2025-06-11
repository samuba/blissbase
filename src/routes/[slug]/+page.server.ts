import { db } from '$lib/server/db';
import { events } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPageMetaTags } from '$lib/common';

export const load = (async ({ params: { slug }, url }) => {
    const event = await db.query.events.findFirst({
        where: eq(events.slug, slug)
    });

    if (!event) {
        throw error(404, 'Event not found');
    }

    return {
        event,
        pageMetaTags: getPageMetaTags({
            name: event.name,
            description: event.description,
            imageUrl: event.imageUrls?.[0],
            url
        })
    };
}) satisfies PageServerLoad;

export type UiEvent = Awaited<ReturnType<typeof load>>['event'];