import { command } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import * as assets from '$lib/assets';
import { db, eq, s } from '$lib/server/db';
import { E2E_TEST } from '$env/static/private';
import { assertUserIsAllowedToEditEvent, eventAssetsCreds } from '$lib/events.remote.shared';

const deleteEventSchema = v.object({
	eventId: v.number(),
	hostSecret: v.string(),
});

export const deleteEvent = command(deleteEventSchema, async ({ eventId, hostSecret }) => {
	await assertUserIsAllowedToEditEvent(eventId, hostSecret);

	try {
		const result = await db
			.delete(s.events)
			.where(eq(s.events.id, eventId))
			.returning({ id: s.events.id, name: s.events.name, imageUrls: s.events.imageUrls });

		if (result[0].imageUrls?.length && E2E_TEST !== `true`) {
			await assets.deleteObjects(result[0].imageUrls, eventAssetsCreds);
		}

		return {
			success: true,
			deletedEvent: result[0],
			message: `Event ${result[0].id} has been deleted successfully`
		};
	} catch (err) {
		console.error(`Failed to delete event:`, err);
		if (err instanceof Error && `status` in err) {
			throw err;
		}
		return error(500, `Failed to delete event`);
	}
});
