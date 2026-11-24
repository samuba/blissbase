import { db } from "#lib/server/db.ts";
import { events } from "#lib/server/schema.ts";
import { eq } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { getPageMetaTags } from "#lib/common.ts";
import { eventWith, prepareEventsForUi } from "#lib/server/events.ts";

export const load = (async ({ params: { slug }, url }) => {
	const event = await db.query.events.findFirst({
		where: eq(events.slug, slug),
		with: eventWith,
	});

	if (!event) {
		throw error(404, "Event not found");
	}

	return {
		event: prepareEventsForUi([event])[0],
		pageMetaTags: getPageMetaTags({
			name: event.name,
			description:
				event.startAt.toLocaleDateString("en-US", {
					year: "numeric",
					month: "short",
					day: "numeric",
				}) +
				" - " +
				event.description,
			imageUrl: event.imageUrls?.[0],
			url,
			sourceUrl: event.sourceUrl,
			source: event.source,
		}),
	};
}) satisfies PageServerLoad;

export type UiEvent = Awaited<ReturnType<typeof load>>["event"];
