import { getFaqRegionEventCounts } from "$lib/rpc/eventCount.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const faqRegionEventCounts = await getFaqRegionEventCounts();
	return { faqRegionEventCounts };
}) satisfies PageLoad;
