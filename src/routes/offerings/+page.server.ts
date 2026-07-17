import { loadFiltersFromCookie } from '$lib/cookie-utils';
import {
	hasOfferingsFilterParams,
	hasOfferingsFilterUrlParams,
	offeringsFilterFromCookie,
} from '$lib/offeringsFilter';
import { routes } from '$lib/routes';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ url, cookies }) => {
	// URL filters win; never write the cookie from a URL visit.
	if (hasOfferingsFilterUrlParams(url)) return {};

	const cookieFilter = offeringsFilterFromCookie(loadFiltersFromCookie(cookies));
	if (!hasOfferingsFilterParams(cookieFilter)) return {};

	redirect(302, routes.offeringsList(cookieFilter));
}) satisfies PageServerLoad;
