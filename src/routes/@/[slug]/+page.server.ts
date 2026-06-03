import { getPageMetaTags } from '$lib/common';
import {
	getOfferingsForPublicProfile,
	getPublicProfileBioExcerpt,
	getPublicProfileBySlug,
	getUpcomingEventsForPublicProfile
} from '$lib/server/profile';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ params, url }) => {
	const profile = await getPublicProfileBySlug({ slug: params.slug });
	if (!profile) {
		throw error(404, `Public profile not found`);
	}

	const [upcomingEvents, publicOfferings] = await Promise.all([
		getUpcomingEventsForPublicProfile({ authorId: profile.id }),
		getOfferingsForPublicProfile({ profile })
	]);
	const profileDisplayName = profile.displayName ?? `Blissbase`;

	return {
		profile,
		upcomingEvents,
		publicOfferings,
		pageMetaTags: getPageMetaTags({
			name: profileDisplayName,
			description: getPublicProfileBioExcerpt({ bio: profile.bio }),
			imageUrl: profile.profileImageUrl ?? profile.bannerImageUrl,
			url
		})
	};
}) satisfies PageServerLoad;
