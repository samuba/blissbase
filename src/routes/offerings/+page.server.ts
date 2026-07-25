import { loadFiltersFromCookie } from "$lib/cookie-utils";
import { hasOfferingsFilterParams, hasOfferingsFilterUrlParams, offeringsFilterFromCookie } from "$lib/offeringsFilter";
import { OFFERING_SLUG_QUERY, routes, withOfferingSlug } from "$lib/routes";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getPageMetaTags } from "$lib/common";

export const load = (async ({ url, cookies }) => {
	// URL filters win; never write the cookie from a URL visit.
	if (!hasOfferingsFilterUrlParams(url)) {
		const cookieFilter = offeringsFilterFromCookie(loadFiltersFromCookie(cookies));
		if (hasOfferingsFilterParams(cookieFilter)) {
			const offeringSlug = url.searchParams.get(OFFERING_SLUG_QUERY)?.trim();
			const listPath = routes.offeringsList(cookieFilter);
			redirect(302, offeringSlug ? withOfferingSlug({ path: listPath, offeringSlug }) : listPath);
		}
	}

	const location = url.searchParams.get("location")?.trim();
	const name = location ? `${location}'s Conscious Offerings` : "Conscious Offerings";
	const description = location ? `Discover conscious offerings in ${location}.` : "Find conscious offerings near you.";

	return {
		pageMetaTags: getPageMetaTags({
			name,
			description,
			imageUrl: "https://www.blissbase.app/og-poster-offerings.jpg",
			url,
		}),
	};
}) satisfies PageServerLoad;
