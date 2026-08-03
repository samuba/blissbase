import { getUserSession } from "$lib/rpc/auth.remote";
import { getMyAuthoredUpcomingEvents } from "$lib/rpc/events.remote";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const [myPublic, session, upcomingEvents] = await Promise.all([
		getMyPublicProfile(),
		getUserSession(),
		getMyAuthoredUpcomingEvents(),
	]);

	return {
		myPublic,
		session,
		upcomingEvents,
	};
}) satisfies PageLoad;
