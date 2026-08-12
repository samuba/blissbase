import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { getOfferings } from "$lib/rpc/offerings.remote";
import type { PageLoad } from "./$types";

export const load = (async ({ url, data }) => {
	const offeringsResult = await getOfferings(parseOfferingsFilterFromUrl(url));
	// Server `+page.server` data is not auto-merged when a universal load exists — forward it.
	return { ...data, offeringsResult };
}) satisfies PageLoad;
