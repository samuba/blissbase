import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as assets from '$lib/assets';
import { isAdminSession } from '$lib/server/admin';
import { db, eq, s } from '$lib/server/db';
import { CLOUDFLARE_ACCOUNT_ID, S3_ACCESS_KEY_ID, S3_BUCKET_NAME, S3_SECRET_ACCESS_KEY } from '$env/static/private';

export const eventAssetsCreds = assets.loadCreds({
	S3_ACCESS_KEY_ID,
	S3_SECRET_ACCESS_KEY,
	S3_BUCKET_NAME,
	CLOUDFLARE_ACCOUNT_ID
});

/**
 * Ensures the current user is allowed to mutate the event.
 *
 * @example
 * await assertUserIsAllowedToEditEvent(1, `secret`)
 */
export async function assertUserIsAllowedToEditEvent(eventId: number, hostSecret: string) {
	const {
		locals: { userId }
	} = getRequestEvent();

	const event = await db.query.events.findFirst({ where: eq(s.events.id, eventId) });
	if (!event) return error(404, `Event not found`);
	if (await isAdminSession()) return event;
	if (userId === event.authorId) return event;
	if (hostSecret === event.hostSecret) return event;

	return error(403, `You are not allowed to edit this event`);
}
