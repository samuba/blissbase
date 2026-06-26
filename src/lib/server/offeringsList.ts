import { getRequestEvent } from '$app/server';
import type { OfferingsFilter } from '$lib/offeringsFilter';
import { filterOfferingsByIncludeOnline, shouldIncludeOfferingInLocationFilter } from '$lib/offeringsFilter';
import { sanitizeLocationParams } from '$lib/locationFilter';
import { db, eq, s } from '$lib/server/db';
import { resolveOfferingsFilterCoordinates } from '$lib/server/offeringsFilter';
import { hasSocialLink, isPublicProfile } from '$lib/server/profile';

export async function loadOfferingsList(args: OfferingsFilter) {
	const sanitized = sanitizeLocationParams({
		plzCity: args.plzCity,
		distance: args.distance,
		lat: args.lat,
		lng: args.lng,
	});
	const filter: OfferingsFilter = {
		plzCity: sanitized.plzCity ?? null,
		distance: sanitized.distance ?? null,
		lat: sanitized.lat ?? null,
		lng: sanitized.lng ?? null,
		searchTerm: args.searchTerm?.trim() || null,
		includeOnline: args.includeOnline ?? false,
	};
	const currentUserId = getRequestEvent().locals.userId;
	const filterCoords = await resolveOfferingsFilterCoordinates(filter);
	const distanceKm = filter.distance ? parseFloat(filter.distance) : null;

	const offerings = await db.query.offerings.findMany({
		where: eq(s.offerings.listed, true),
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
		orderBy: (offerings, { desc }) => [desc(offerings.createdAt)],
	});

	return {
		filter,
		offerings: filterOfferingsByIncludeOnline({
			offerings: offerings
				.filter((offering) => {
					if (!offering.profile || !isPublicProfile(offering.profile)) return false;
					if (!hasSocialLink(offering.profile)) return false;
					if (!filterCoords || distanceKm == null || Number.isNaN(distanceKm)) return true;

					return shouldIncludeOfferingInLocationFilter({
						format: offering.format,
						includeOnline: filter.includeOnline,
						profileLatitude: offering.profile.latitude,
						profileLongitude: offering.profile.longitude,
						filterCoords,
						distanceKm,
					});
				})
				.map((offering) => ({
					...offering,
					descriptionHtml: offering.descriptionHtml ?? ``,
					imageUrls: offering.imageUrls ?? [],
					profile: {
						...offering.profile,
						bio: offering.profile.bio ?? ``,
						profileImageUrl: offering.profile.profileImageUrl ?? ``,
						bannerImageUrl: offering.profile.bannerImageUrl ?? ``,
						locationLabel: offering.profile.locationLabel ?? ``,
					},
					canManage: currentUserId === offering.profile.id,
				})),
			includeOnline: filter.includeOnline,
		}),
	};
}
