import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { getOfferings } from "$lib/rpc/offerings.remote";
import type { PageLoad } from "./$types";

export const load = (async ({ url }) => {
	const offeringsResult = await getOfferings(parseOfferingsFilterFromUrl(url));
	return { offeringsResult };
}) satisfies PageLoad;
