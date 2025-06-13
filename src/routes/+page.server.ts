import { fetchEvents } from "$lib/server/events";
import type { PageServerLoad } from "./$types";

export const load = (async () => {
    const { events, pagination } = await fetchEvents({});
    return {
        events,
        pagination
    };
}) satisfies PageServerLoad;
