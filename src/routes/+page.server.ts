import { fetchEvents } from "$lib/server/events";
import type { PageServerLoad } from "./$types";

export const load = (async ({ locals: { requestInfo } }) => {
    return await fetchEvents({
        plzCity: requestInfo.city,
    });
}) satisfies PageServerLoad;
