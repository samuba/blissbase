import { loadFiltersFromCookie } from '$lib/cookie-utils';
import { hasOfferingsLocationParams, parseOfferingsFilterFromUrl } from '$lib/offeringsFilter';
import { loadOfferingsList } from '$lib/server/offeringsList';
import { routes } from '$lib/routes';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ url, cookies }) => {
	const filter = parseOfferingsFilterFromUrl(url);

	if (!hasOfferingsLocationParams(filter)) {
		const savedFilters = loadFiltersFromCookie(cookies);
		if (savedFilters) {
			const cookieFilter = {
				plzCity: savedFilters.plzCity ?? null,
				distance: savedFilters.distance ?? null,
				lat: savedFilters.lat ?? null,
				lng: savedFilters.lng ?? null,
				searchTerm: filter.searchTerm,
				includeOnline: filter.includeOnline,
			};

			if (hasOfferingsLocationParams(cookieFilter)) {
				redirect(302, routes.offeringsList(cookieFilter));
			}
		}
	}

	return await loadOfferingsList(filter);
}) satisfies PageServerLoad;
