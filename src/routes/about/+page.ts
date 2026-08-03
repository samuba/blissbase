import { estimateEventCount } from "$lib/rpc/eventCount.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const eventCount = Math.floor((await estimateEventCount()) / 1000) * 1000;
	return { eventCount };
}) satisfies PageLoad;
