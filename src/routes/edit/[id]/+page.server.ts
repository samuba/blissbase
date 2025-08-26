import { error } from '@sveltejs/kit';
import { db, s } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { isAdminSession } from '$lib/server/admin';

export async function load({ url, params: { id } }) {
    if (!id || isNaN(Number(id))) error(400, 'Invalid event ID');


    const event = await db.query.events.findFirst({ where: eq(s.events.id, Number(id)) });
    if (!event) error(404, 'Event not found');

    if (!await isAdminSession()) {
        const hostSecret = url.searchParams.get('hostSecret');
        if (!hostSecret) error(400, 'Host secret is required');
        if (event.hostSecret !== hostSecret) error(403, 'Invalid host secret');
    }

    return {
        event
    };
}
