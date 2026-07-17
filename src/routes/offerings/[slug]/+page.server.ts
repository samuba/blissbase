import { getPageMetaTags } from "$lib/common";
import { and, db, eq, or, s } from "$lib/server/db";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load = (async ({ locals, params: { slug }, url }) => {
	const offering = await db.query.offerings.findFirst({
		where: locals.userId
			? and(eq(s.offerings.slug, slug), or(eq(s.offerings.listed, true), eq(s.offerings.profileId, locals.userId)))
			: and(eq(s.offerings.slug, slug), eq(s.offerings.listed, true)),
		columns: {
			id: true,
			slug: true,
			title: true,
			descriptionHtml: true,
			format: true,
			imageUrls: true,
			listed: true,
		},
		with: {
			profile: {
				columns: {
					id: true,
					slug: true,
					displayName: true,
					bio: true,
					profileImageUrl: true,
					bannerImageUrl: true,
					socialLinks: true,
					locationLabel: true,
					latitude: true,
					longitude: true,
				},
			},
		},
	});

	if (!offering?.profile) {
		error(404, `Offering not found`);
	}

	const normalizedOffering = {
		...offering,
		descriptionHtml: offering.descriptionHtml ?? ``,
		imageUrls: offering.imageUrls ?? [],
		canManage: locals.userId === offering.profile.id || locals.isAdminSession,
		profile: {
			...offering.profile,
			bio: offering.profile.bio ?? ``,
			profileImageUrl: offering.profile.profileImageUrl ?? ``,
			bannerImageUrl: offering.profile.bannerImageUrl ?? ``,
			locationLabel: offering.profile.locationLabel ?? ``,
		},
	};

	return {
		offering: normalizedOffering,
		pageMetaTags: getPageMetaTags({
			name: offering.title,
			description: offering.descriptionHtml,
			imageUrl: offering.imageUrls?.[0],
			url,
		}),
	};
}) satisfies PageServerLoad;
