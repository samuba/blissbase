import { getFavoriteUpcomingEvents } from "$lib/rpc/favorites.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const upcomingEvents = await getFavoriteUpcomingEvents();
	return { upcomingEvents };
}) satisfies PageLoad;
