import { loadFiltersFromCookie } from '$lib/cookie-utils';
import {
	hasOfferingsFilterParams,
	hasOfferingsFilterUrlParams,
	offeringsFilterFromCookie,
} from '$lib/offeringsFilter';
import { OFFERING_SLUG_QUERY, routes, withOfferingSlug } from '$lib/routes';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ url, cookies }) => {
	// URL filters win; never write the cookie from a URL visit.
	if (hasOfferingsFilterUrlParams(url)) return {};

	const cookieFilter = offeringsFilterFromCookie(loadFiltersFromCookie(cookies));
	if (!hasOfferingsFilterParams(cookieFilter)) return {};

	const offeringSlug = url.searchParams.get(OFFERING_SLUG_QUERY)?.trim();
	const listPath = routes.offeringsList(cookieFilter);
	redirect(
		302,
		offeringSlug ? withOfferingSlug({ path: listPath, offeringSlug }) : listPath,
	);
}) satisfies PageServerLoad;
