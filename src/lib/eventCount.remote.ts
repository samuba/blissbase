import { prerender } from '$app/server';
import { db, eq, s } from '$lib/server/db';

/**
 * Returns the number of listed events for static UI copy.
 *
 * @example
 * await estimateEventCount()
 */
export const estimateEventCount = prerender(async () => {
	return await db.$count(s.events, eq(s.events.listed, true));
});
