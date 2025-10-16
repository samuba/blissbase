import { db } from '$lib/server/db';
import { events } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPageMetaTags } from '$lib/common';
import { eventWith, prepareEventsForUi } from '$lib/server/events';

export const load = (async ({ params: { slug }, url }) => {
    const event = await db.query.events.findFirst({
        where: eq(events.slug, slug),
        with: eventWith
    });

    if (!event) {
        throw error(404, 'Event not found');
    }

    return {
        event: prepareEventsForUi([event])[0],
        pageMetaTags: getPageMetaTags({
            name: event.name,
            description: event.startAt.toLocaleDateString('de-DE', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            }) + " - " + event.description,
            imageUrl: event.imageUrls?.[0],
            url,
            sourceUrl: event.sourceUrl
        })
    };
}) satisfies PageServerLoad;

export type UiEvent = Awaited<ReturnType<typeof load>>['event'];