import { form, query } from '$app/server';
import * as assets from '$lib/assets';
import {
	OFFERING_PLACE_FILTERS,
	offeringFormSchema,
	type OfferingFormat,
	type OfferingPlaceFilter
} from '$lib/rpc/offerings.common';
import { getMyPublicProfile } from '$lib/rpc/profile.remote';
import { routes } from '$lib/routes';
import { eventAssetsCreds } from '$lib/events.remote.shared';
import { ensureUserId } from '$lib/server/common';
import { and, db, eq, ne, s, sql } from '$lib/server/db';
import { createPublicProfileSlug, isPublicProfile } from '$lib/server/profile';
import type { Profile } from '$lib/server/schema';
import { error, invalid, redirect } from '@sveltejs/kit';
import * as v from 'valibot';

const placeFilterSchema = v.object({
	filter: v.optional(v.picklist(OFFERING_PLACE_FILTERS), `online`)
});

export const getOfferings = query(placeFilterSchema, async ({ filter }) => {
	const [offerings, places] = await Promise.all([
		db.query.offerings.findMany({
			where: eq(s.offerings.listed, true),
			columns: {
				id: true,
				title: true,
				descriptionHtml: true,
				format: true
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
						placeId: true
					},
					with: {
						place: {
							columns: {
								id: true,
								name: true,
								slug: true
							}
						}
					}
				}
			},
			orderBy: (offerings, { desc }) => [desc(offerings.createdAt)]
		}),
		db.query.places.findMany({
			columns: { id: true, name: true, slug: true }
		})
	]);

	const filterPlaceIds = getPlaceIdsForFilter({ filter, places });

	return {
		filter,
		offerings: offerings
			.filter((offering) => {
				if (!offering.profile || !isPublicProfile(offering.profile)) return false;
				if (!hasSocialLink(offering.profile)) return false;
				if (filter === `online`) return isOnlineOffering(offering.format);
				return (
					isOfflineOffering(offering.format) &&
					filterPlaceIds.includes(offering.profile.placeId ?? -1)
				);
			})
			.map((offering) => ({
				id: offering.id,
				title: offering.title,
				descriptionHtml: offering.descriptionHtml ?? ``,
				format: offering.format,
				profile: {
					slug: offering.profile.slug,
					displayName: offering.profile.displayName,
					bio: offering.profile.bio ?? ``,
					profileImageUrl: offering.profile.profileImageUrl ?? ``,
					bannerImageUrl: offering.profile.bannerImageUrl ?? ``,
					socialLinks: offering.profile.socialLinks,
					place: offering.profile.place
						? {
								name: offering.profile.place.name,
								slug: offering.profile.place.slug
							}
						: null
				}
			}))
	};
});

export const createOffering = form(offeringFormSchema, async (data, issue) => {
	const userId = ensureUserId();
	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	const nextProfile = data.profile
		? await updateProfileFromOfferingForm({ currentProfile, data: data.profile, issue })
		: currentProfile;

	if (!hasSocialLink(nextProfile)) {
		return invalid(issue.profile.socialLinks(`Bitte füge mindestens einen Social-Link hinzu.`));
	}
	if (!isPublicProfile(nextProfile)) {
		return invalid(issue.profile.displayName(`Bitte vervollständige dein öffentliches Profil.`));
	}

	const [offering] = await db
		.insert(s.offerings)
		.values({
			profileId: userId,
			title: data.title,
			descriptionHtml: data.descriptionHtml || null,
			format: data.format,
			listed: true
		})
		.returning({ id: s.offerings.id });

	getMyPublicProfile().refresh();
	refreshOfferingLists();

	redirect(
		303,
		routes.offeringsList(
			defaultFilterForOffering({
				format: data.format,
				placeId: nextProfile.placeId
			}),
			offering?.id
		)
	);
});

/**
 * Updates only the profile fields collected during offering onboarding.
 *
 * @example
 * await updateProfileFromOfferingForm({ currentProfile, data, issue });
 */
async function updateProfileFromOfferingForm(args: UpdateProfileFromOfferingFormArgs) {
	const fallbackSlug = createPublicProfileSlug({ displayName: args.data.displayName });
	const slug = args.data.slug || args.currentProfile.slug || fallbackSlug;
	if (!slug) {
		return invalid(args.issue.profile.slug(`Profil-URL muss ausgefüllt werden`));
	}

	const existingSlugOwner = await db.query.profiles.findFirst({
		where: and(eq(s.profiles.slug, slug), ne(s.profiles.id, args.currentProfile.id)),
		columns: { id: true }
	});
	if (existingSlugOwner) {
		return invalid(args.issue.profile.slug(`Dieser Slug ist bereits vergeben`));
	}

	const nextProfileImageUrl = assertOwnedProfileImageUrl({
		submittedUrl: args.data.profileImageUrl,
		currentUrl: args.currentProfile.profileImageUrl,
		userId: args.currentProfile.id
	});
	if (nextProfileImageUrl instanceof Error) {
		return invalid(args.issue.profile.profileImageUrl(nextProfileImageUrl.message));
	}

	const nextBannerImageUrl = assertOwnedProfileImageUrl({
		submittedUrl: args.data.bannerImageUrl,
		currentUrl: args.currentProfile.bannerImageUrl,
		userId: args.currentProfile.id
	});
	if (nextBannerImageUrl instanceof Error) {
		return invalid(args.issue.profile.bannerImageUrl(nextBannerImageUrl.message));
	}

	const [updatedProfile] = await db
		.update(s.profiles)
		.set({
			displayName: args.data.displayName,
			slug,
			bio: args.data.bio || null,
			placeId: args.data.placeId ?? null,
			socialLinks: args.data.socialLinks,
			profileImageUrl: nextProfileImageUrl,
			bannerImageUrl: nextBannerImageUrl,
			updatedAt: sql`now()`
		})
		.where(eq(s.profiles.id, args.currentProfile.id))
		.returning();

	await Promise.all([
		sweepProfileImagePrefix({
			userId: args.currentProfile.id,
			kind: `profile`,
			keepUrl: nextProfileImageUrl
		}),
		sweepProfileImagePrefix({
			userId: args.currentProfile.id,
			kind: `banner`,
			keepUrl: nextBannerImageUrl
		})
	]);

	return updatedProfile;
}

function getPlaceIdsForFilter(args: {
	filter: OfferingPlaceFilter;
	places: Array<{ id: number; slug: string }>;
}) {
	if (args.filter === `danang`)
		return args.places.filter((place) => place.slug === `danang`).map((place) => place.id);
	if (args.filter === `hoi-an`)
		return args.places.filter((place) => place.slug === `hoi-an`).map((place) => place.id);
	if (args.filter === `danang-hoi-an`) {
		return args.places
			.filter((place) => [`danang`, `hoi-an`].includes(place.slug))
			.map((place) => place.id);
	}
	return [];
}

function defaultFilterForOffering(args: { format: OfferingFormat; placeId: number | null }) {
	if (isOnlineOffering(args.format)) return `online`;
	if (!args.placeId) return `online`;
	return `danang-hoi-an`;
}

function isOnlineOffering(format: OfferingFormat) {
	return format === `online` || format === `offline+online`;
}

function isOfflineOffering(format: OfferingFormat) {
	return format === `offline` || format === `offline+online`;
}

function hasSocialLink(profile: Pick<Profile, 'socialLinks'> | null | undefined) {
	return Boolean(profile?.socialLinks?.some((link) => link.value?.trim()));
}

function refreshOfferingLists() {
	for (const filter of OFFERING_PLACE_FILTERS) {
		getOfferings({ filter }).refresh();
	}
}

function assertOwnedProfileImageUrl(args: AssertOwnedProfileImageUrlArgs) {
	const submitted = args.submittedUrl?.trim() || ``;
	if (!submitted) return null;
	if (submitted === args.currentUrl) return submitted;

	const expectedPrefix = assets.publicUrl(`profiles/${args.userId}/`);
	if (!submitted.startsWith(expectedPrefix)) {
		return new Error(`Bild-URL ist nicht erlaubt`);
	}
	return submitted;
}

async function sweepProfileImagePrefix(args: SweepProfileImagePrefixArgs) {
	const prefix = `profiles/${args.userId}/${args.kind}`;
	const keepKey = assets.objectKeyFromPublicUrl(args.keepUrl);
	const allKeys = await assets.listObjectKeysByPrefix({ prefix, creds: eventAssetsCreds });
	const orphanKeys = allKeys.filter((key) => key !== keepKey);
	if (!orphanKeys?.length) return;
	await assets.deleteObjects(orphanKeys, eventAssetsCreds);
}

type UpdateProfileFromOfferingFormArgs = {
	currentProfile: Profile;
	data: NonNullable<v.InferOutput<typeof offeringFormSchema>['profile']>;
	issue: OfferingFormIssue;
};

type OfferingFormIssue = {
	profile: {
		slug: (message: string) => InvalidIssue;
		profileImageUrl: (message: string) => InvalidIssue;
		bannerImageUrl: (message: string) => InvalidIssue;
	};
};

type InvalidIssue = Parameters<typeof invalid>[0];

type AssertOwnedProfileImageUrlArgs = {
	submittedUrl?: string | null;
	currentUrl?: string | null;
	userId: string;
};

type SweepProfileImagePrefixArgs = {
	userId: string;
	kind: `profile` | `banner`;
	keepUrl: string | null;
};
