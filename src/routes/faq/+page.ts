import { getFaqCountryEventCounts } from "#lib/rpc/eventCount.remote.ts";
import type { PageLoad } from "./$types";

const MIN_FAQ_COUNTRY_EVENT_COUNT = 100;

export const load = (async () => {
	const faqCountryEventCounts = await getFaqCountryEventCounts();
	return {
		faqCountryEventCounts: {
			regions: faqCountryEventCounts.regions.filter((region) => region.count > MIN_FAQ_COUNTRY_EVENT_COUNT),
		},
	};
}) satisfies PageLoad;
