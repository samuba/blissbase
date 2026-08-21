import { parseOfferingsFilterFromUrl } from '$lib/offeringsFilter';
import {
	FALLBACK_OFFERINGS_OG_IMAGE,
	resolveOfferingsOgImageUrl,
} from '$lib/server/og/offeringsOg';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const filter = parseOfferingsFilterFromUrl(url);

	try {
		const imageUrl = await resolveOfferingsOgImageUrl(filter);
		return redirectToImage(imageUrl);
	} catch (error) {
		console.error(`Failed serving offerings OG image:`, error);
		return redirectToImage(FALLBACK_OFFERINGS_OG_IMAGE);
	}
};

function redirectToImage(imageUrl: string) {
	return new Response(null, {
		status: 302,
		headers: {
			Location: imageUrl,
			// Short cache on the resolver so a miss→fallback doesn't stick for a day
			// after background warm finishes.
			'Cache-Control': `public, max-age=60`,
		},
	});
}
