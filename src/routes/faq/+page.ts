import { getFaqCountryEventCounts } from "$lib/rpc/eventCount.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const faqCountryEventCounts = await getFaqCountryEventCounts();
	return { faqCountryEventCounts };
}) satisfies PageLoad;
