import { getFaqRecentEventCounts } from "$lib/rpc/eventCount.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const faqRecentEventCounts = await getFaqRecentEventCounts();
	return { faqRecentEventCounts };
}) satisfies PageLoad;
