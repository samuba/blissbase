import { getPageMetaTags } from '$lib/common';
import {
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

	const upcomingEvents = await getUpcomingEventsForPublicProfile({ authorId: profile.id });

	return {
		profile,
		upcomingEvents,
		pageMetaTags: getPageMetaTags({
			name: profile.displayName,
			description: getPublicProfileBioExcerpt({ bio: profile.bio }),
			imageUrl: profile.profileImageUrl ?? profile.bannerImageUrl,
			url
		})
	};
}) satisfies PageServerLoad;
