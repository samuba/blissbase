import { getMyAuthoredUpcomingEvents } from "$lib/rpc/events.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const upcomingEvents = await getMyAuthoredUpcomingEvents();
	return { upcomingEvents };
}) satisfies PageLoad;
