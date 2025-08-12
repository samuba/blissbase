import { command, query } from '$app/server';
import { isAdminSession } from '$lib/server/admin';
import { db, s } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';

export const getIsAdminSession = query(async () => isAdminSession());

export const deleteEvent = command(v.number(), async (eventId: number) => {
    if (!getIsAdminSession()) {
        return error(403, 'Unauthorized - Admin access required');
    }

    try {
        const result = await db
            .delete(s.events)
            .where(eq(s.events.id, eventId))
            .returning({ id: s.events.id, name: s.events.name });

        if (result.length === 0) {
            return error(404, 'Event not found');
        }

        return {
            success: true,
            deletedEvent: result[0],
            message: `Event ${result[0].id} has been deleted successfully`
        };
    } catch (err) {
        console.error('Failed to delete event:', err);
        if (err instanceof Error && 'status' in err) {
            throw err; // Re-throw SvelteKit errors
        }
        return error(500, 'Failed to delete event');
    }
});
