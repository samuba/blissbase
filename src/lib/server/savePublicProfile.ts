import { dev } from "$app/environment";
import { E2E_TEST } from "$env/static/private";
import * as assets from "$lib/assets";
import { randomString } from "$lib/common";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
import { db, s, and, eq, ne, sql } from "$lib/server/db";
import { createPublicProfileSlug } from "$lib/server/profile";
import { resolveProfileImageUrl } from "$lib/server/profileImages";
import type { Profile } from "$lib/server/schema";
import { error, invalid } from "@sveltejs/kit";

const isE2eTestMode = E2E_TEST === `true` && dev;

/**
 * Merges a create-flow profile patch into the authenticated profile.
 *
 * @example
 * await mergeProfileFromForm({ currentProfile, data, issue });
 */
export async function mergeProfileFromForm(args: MergeProfileFromFormArgs) {
	const currentSlug = args.currentProfile.slug?.trim();
	const displayName = args.data.displayName?.trim() ?? args.currentProfile.displayName;
	const slug =
		currentSlug ||
		(await createAvailableProfileSlug({
			displayName: displayName ?? ``,
			profileId: args.currentProfile.id,
		}));

	const submittedProfileImageUrl = args.data.profileImageUrl?.trim();
	const nextProfileImageUrl = submittedProfileImageUrl
		? await resolveProfileImageUrl({
				submittedUrl: submittedProfileImageUrl,
				currentUrl: args.currentProfile.profileImageUrl,
				userId: args.currentProfile.id,
				expectedType: `profile`,
			})
		: args.currentProfile.profileImageUrl;
	if (nextProfileImageUrl instanceof Error) {
		return invalid(args.issue.profile.profileImageUrl(nextProfileImageUrl.message));
	}

	const submittedBannerImageUrl = args.data.bannerImageUrl?.trim();
	const nextBannerImageUrl = submittedBannerImageUrl
		? await resolveProfileImageUrl({
				submittedUrl: submittedBannerImageUrl,
				currentUrl: args.currentProfile.bannerImageUrl,
				userId: args.currentProfile.id,
				expectedType: `banner`,
			})
		: args.currentProfile.bannerImageUrl;
	if (nextBannerImageUrl instanceof Error) {
		return invalid(args.issue.profile.bannerImageUrl(nextBannerImageUrl.message));
	}

	const submittedLocationLabel = args.data.locationLabel?.trim();
	const hasSubmittedLocation = `locationLabel` in args.data || `latitude` in args.data || `longitude` in args.data;

	return {
		...args.currentProfile,
		displayName,
		slug,
		bio: `bio` in args.data ? args.data.bio?.trim() || null : args.currentProfile.bio,
		locationLabel: hasSubmittedLocation ? submittedLocationLabel || null : args.currentProfile.locationLabel,
		latitude: hasSubmittedLocation ? (args.data.latitude ?? null) : args.currentProfile.latitude,
		longitude: hasSubmittedLocation ? (args.data.longitude ?? null) : args.currentProfile.longitude,
		socialLinks: args.data.socialLinks ?? args.currentProfile.socialLinks,
		profileImageUrl: nextProfileImageUrl,
		bannerImageUrl: nextBannerImageUrl,
	};
}

export function hasPublicProfileChanges(args: { current: PublicProfileComparable; next: PublicProfileComparable }) {
	const { current, next } = args;
	if (current.displayName !== next.displayName) return true;
	if (current.slug !== next.slug) return true;
	if (current.bio !== next.bio) return true;
	if (current.locationLabel !== next.locationLabel) return true;
	if (current.latitude !== next.latitude) return true;
	if (current.longitude !== next.longitude) return true;
	if (current.profileImageUrl !== next.profileImageUrl) return true;
	if (current.bannerImageUrl !== next.bannerImageUrl) return true;
	return JSON.stringify(current.socialLinks) !== JSON.stringify(next.socialLinks);
}

/**
 * Persists public profile fields and removes leftover profile/banner images.
 *
 * @example
 * await savePublicProfile(nextProfile);
 */
export async function savePublicProfile(profile: Profile) {
	const [updatedProfile] = await db
		.update(s.profiles)
		.set({
			displayName: profile.displayName,
			slug: profile.slug,
			bio: profile.bio,
			locationLabel: profile.locationLabel,
			latitude: profile.latitude,
			longitude: profile.longitude,
			socialLinks: profile.socialLinks,
			profileImageUrl: profile.profileImageUrl,
			bannerImageUrl: profile.bannerImageUrl,
			updatedAt: sql`now()`,
		})
		.where(eq(s.profiles.id, profile.id))
		.returning();

	await Promise.all([
		sweepProfileImagePrefix({
			userId: profile.id,
			kind: `profile`,
			keepUrl: profile.profileImageUrl,
		}),
		sweepProfileImagePrefix({
			userId: profile.id,
			kind: `banner`,
			keepUrl: profile.bannerImageUrl,
		}),
	]);

	return updatedProfile ?? profile;
}

async function createAvailableProfileSlug(args: { displayName: string; profileId: string }) {
	const baseSlug = createPublicProfileSlug(args.displayName);
	for (let attempt = 0; attempt < 100; attempt++) {
		const suffix = attempt === 0 ? `` : `-${randomString(2).toLowerCase()}`;
		const slug = `${baseSlug.slice(0, 80 - suffix.length)}${suffix}`;
		if (await isProfileSlugAvailable({ slug, profileId: args.profileId })) return slug;
	}

	throw error(409, `Could not create a unique profile slug`);
}

async function isProfileSlugAvailable(args: { slug: string; profileId: string }) {
	const existingSlugOwner = await db.query.profiles.findFirst({
		where: and(eq(s.profiles.slug, args.slug), ne(s.profiles.id, args.profileId)),
		columns: { id: true },
	});

	return !existingSlugOwner;
}

async function sweepProfileImagePrefix(args: SweepProfileImagePrefixArgs) {
	if (isE2eTestMode) return;

	const prefix = `profiles/${args.userId}/${args.kind}`;
	const keepKey = assets.objectKeyFromPublicUrl(args.keepUrl);
	const allKeys = await assets.listObjectKeysByPrefix({ prefix, creds: eventAssetsCreds });
	const orphanKeys = allKeys.filter((key) => key !== keepKey);
	if (!orphanKeys?.length) return;
	await assets.deleteObjects(orphanKeys, eventAssetsCreds);
}

type PublicProfileComparable = Pick<
	Profile,
	`displayName` | `slug` | `bio` | `locationLabel` | `latitude` | `longitude` | `profileImageUrl` | `bannerImageUrl` | `socialLinks`
>;

type ProfilePatch = {
	displayName?: string;
	bio?: string;
	profileImageUrl?: string;
	bannerImageUrl?: string;
	socialLinks?: PublicProfileSocialLinks;
	locationLabel?: string;
	latitude?: number | null;
	longitude?: number | null;
};

type MergeProfileFromFormArgs = {
	currentProfile: Profile;
	data: ProfilePatch;
	issue: {
		profile: {
			profileImageUrl: (message: string) => InvalidIssue;
			bannerImageUrl: (message: string) => InvalidIssue;
		};
	};
};

type InvalidIssue = Parameters<typeof invalid>[0];

type SweepProfileImagePrefixArgs = {
	userId: string;
	kind: `profile` | `banner`;
	keepUrl: string | null;
};
