import { loadFiltersFromCookie } from "$lib/cookie-utils";
import { hasOfferingsFilterParams, hasOfferingsFilterUrlParams, offeringsFilterFromCookie, parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { absoluteUrl, OFFERING_SLUG_QUERY, routes, withOfferingSlug } from "$lib/routes";
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

	const filter = parseOfferingsFilterFromUrl(url);
	const location = filter.location?.trim();
	const name = location ? `${location}'s Conscious Offerings` : "Conscious Offerings";
	const description = location ? `Discover conscious offerings in ${location}.` : "Find conscious offerings near you.";
	const pageMetaTags = getPageMetaTags({
		name,
		description,
		imageUrl: absoluteUrl(routes.offeringsOg(filter)),
		url,
	});
	const ogImage = pageMetaTags.openGraph.images?.[0];
	if (ogImage) {
		ogImage.width = 1200;
		ogImage.height = 630;
		ogImage.type = `image/png`;
	}

	return {
		pageMetaTags,
	};
}) satisfies PageServerLoad;
