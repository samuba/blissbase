import { error } from "@sveltejs/kit";
import { noindexPageMetaTags } from "#lib/common.ts";
import { db, s } from "#lib/server/db.ts";
import { eq } from "drizzle-orm";
import { isAdminSession } from "#lib/server/admin.ts";
import { getEditEventInitialValues } from "#lib/eventForm.common.ts";
import type { Config } from "@sveltejs/adapter-vercel";
import { getRequestEvent } from "$app/server";

export const config: Config = {
	split: true,
};

export async function load({ url, params: { id } }) {
	if (!id || isNaN(Number(id))) error(400, "Invalid event ID");

	const event = await db.query.events.findFirst({
		where: eq(s.events.id, Number(id)),
	});
	if (!event) error(404, "Event not found");

	const hostSecret = url.searchParams.get("hostSecret");
	const hostSecretCorrect = hostSecret && event.hostSecret === hostSecret;
	const {
		locals: { userId },
	} = await getRequestEvent();
	const userIsAuthor = event.authorId === userId;

	if (hostSecretCorrect || userIsAuthor || (await isAdminSession())) {
		return {
			event,
			editFormValues: getEditEventInitialValues(event),
			pageMetaTags: noindexPageMetaTags,
		};
	}

	error(403, "You are not allowed to edit this event");
}
