import { command } from "$app/server";
import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { db, eq, s } from "#lib/server/db.ts";
import { assertUserIsAllowedToEditEvent } from "#lib/eventForm.shared.ts";
import { getMyAuthoredPastEvents, getMyAuthoredUpcomingEvents } from "#lib/rpc/events.remote.ts";
import { setFlash } from "#lib/server/flash.ts";

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

		getMyAuthoredUpcomingEvents().refresh();
		getMyAuthoredPastEvents().refresh();
		setFlash(`eventDeleted`);
		return {
			success: true,
			deletedEvent: result[0],
			message: `Event ${result[0].id} has been deleted successfully`,
		};
	} catch (err) {
		console.error(`Failed to delete event:`, err);
		if (err instanceof Error && `status` in err) {
			throw err;
		}
		return error(500, `Failed to delete event`);
	}
});
