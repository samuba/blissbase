import { command, form, query } from "$app/server";
import * as assets from "$lib/assets";
import { randomString } from "$lib/common";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { publicProfileFormSchema } from "$lib/rpc/profile.common";
import { routes } from "$lib/routes";
import { ensureUserId } from "$lib/server/common";
import { db, s, and, eq, ne, sql } from "$lib/server/db";
import {
	createPublicProfileSlug,
	getPublicProfileBySlug,
	hasSocialLink,
	isPublicProfile,
	getUpcomingEventsForPublicProfile,
} from "$lib/server/profile";
import { resolveProfileImageUrl, signProfileImageClaim } from "$lib/server/profileImages";
import { error, invalid, redirect } from "@sveltejs/kit";
import * as v from "valibot";

export const getPublicProfile = query(v.object({ slug: v.pipe(v.string(), v.trim(), v.nonEmpty()) }), async ({ slug }) => {
	const profile = await getPublicProfileBySlug({ slug });
	if (!profile) throw error(404, `Public profile not found`);

	return {
		profile,
		upcomingEvents: await getUpcomingEventsForPublicProfile({ authorId: profile.id }),
	};
});

export const getMyPublicProfile = query(async () => {
	const userId = ensureUserId();
	const profile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!profile) throw error(404, `Profile not found`);

	return {
		displayName: profile.displayName ?? ``,
		slug: profile.slug ?? ``,
		bio: profile.bio ?? ``,
		socialLinks: profile.socialLinks,
		profileImageUrl: profile.profileImageUrl ?? ``,
		bannerImageUrl: profile.bannerImageUrl ?? ``,
		locationLabel: profile.locationLabel ?? ``,
		latitude: profile.latitude,
		longitude: profile.longitude,
		isPublic: isPublicProfile(profile),
	};
});

export const checkEmailProfileComplete = command(
	v.object({
		email: v.pipe(v.string(), v.trim(), v.email()),
	}),
	async ({ email }) => {
		const rows = await db.execute<{ id: string }>(sql`select id::text as id from auth.users where lower(email) = lower(${email}) limit 1`);
		const userId = rows[0]?.id;
		if (!userId) return { profileComplete: false };

		const profile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
		return {
			profileComplete: isPublicProfile(profile) && hasSocialLink(profile),
		};
	},
);

export const checkSlugAvailability = query(
	v.object({
		slug: v.pipe(v.string(), v.trim()),
	}),
	async ({ slug }) => {
		const userId = ensureUserId();
		const normalizedSlug = slug ? createPublicProfileSlug({ displayName: slug }) : ``;
		if (!normalizedSlug) {
			return { slug: normalizedSlug, available: false };
		}

		const existingProfile = await db.query.profiles.findFirst({
			where: and(eq(s.profiles.slug, normalizedSlug), ne(s.profiles.id, userId)),
			columns: { id: true },
		});

		return {
			slug: normalizedSlug,
			available: !existingProfile,
		};
	},
);

// Note: browsers upload directly to R2 using the returned presigned URL, which requires CORS
// on the bucket to allow PUT requests with a Content-Type header. See docs/r2-cors.md.
export const createProfileImageUploadUrl = command(
	v.object({
		type: v.picklist([`profile`, `banner`]),
		contentType: v.picklist([`image/webp`, `image/jpeg`]),
	}),
	async ({ type, contentType }) => {
		// Timestamp prefix keeps keys naturally sorted; random tail avoids collisions on parallel uploads.
		const suffix = `${Date.now().toString(36)}-${randomString(6).toLowerCase()}`;
		const objectKey = assets.profileTempImageObjectKey({
			type,
			suffix,
			contentType,
		});
		const uploadUrl = await assets.getPresignedPutUrl({ objectKey, creds: eventAssetsCreds });
		const claimToken = signProfileImageClaim({ objectKey, type, contentType });
		return {
			uploadUrl,
			publicUrl: `${assets.publicUrl(objectKey)}#${claimToken}`,
			objectKey,
			contentType,
			claimToken,
		};
	},
);

export const upsertPublicProfile = form(publicProfileFormSchema, async (data, issue) => {
	const userId = ensureUserId();
	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	const slug = (data.slug ?? ``) || (currentProfile.slug ?? ``);
	if (!slug) {
		return invalid(issue.slug(`Profil-URL muss ausgefüllt werden`));
	}

	const existingSlugOwner = await db.query.profiles.findFirst({
		where: and(eq(s.profiles.slug, slug), ne(s.profiles.id, userId)),
		columns: { id: true },
	});
	if (existingSlugOwner) {
		return invalid(issue.slug(`Dieser Slug ist bereits vergeben`));
	}

	const nextProfileImageUrl = await resolveProfileImageUrl({
		submittedUrl: data.profileImageUrl,
		currentUrl: currentProfile.profileImageUrl,
		userId,
		expectedType: `profile`,
	});
	if (nextProfileImageUrl instanceof Error) {
		return invalid(issue.profileImageUrl(nextProfileImageUrl.message));
	}
	const nextBannerImageUrl = await resolveProfileImageUrl({
		submittedUrl: data.bannerImageUrl,
		currentUrl: currentProfile.bannerImageUrl,
		userId,
		expectedType: `banner`,
	});
	if (nextBannerImageUrl instanceof Error) {
		return invalid(issue.bannerImageUrl(nextBannerImageUrl.message));
	}

	await db
		.update(s.profiles)
		.set({
			displayName: data.displayName,
			slug,
			bio: data.bio || null,
			locationLabel: data.locationLabel?.trim() || null,
			latitude: data.latitude ?? null,
			longitude: data.longitude ?? null,
			socialLinks: data.socialLinks,
			profileImageUrl: nextProfileImageUrl,
			bannerImageUrl: nextBannerImageUrl,
			updatedAt: sql`now()`,
		})
		.where(eq(s.profiles.id, userId));

	// Sweep both image prefixes: delete anything in R2 that isn't the newly-saved image.
	// This self-heals after abandoned session uploads, removed images, and failed form submissions.
	await Promise.all([
		sweepProfileImagePrefix({ userId, kind: `profile`, keepUrl: nextProfileImageUrl }),
		sweepProfileImagePrefix({ userId, kind: `banner`, keepUrl: nextBannerImageUrl }),
	]);

	getMyPublicProfile().refresh();
	getPublicProfile({ slug }).refresh();

	redirect(303, routes.publicProfile(slug));
});

/**
 * Deletes every object under `profiles/{userId}/{kind}-` except the one pointed to by `keepUrl`.
 * Runs after a profile save so orphaned uploads from aborted sessions or failed submits disappear.
 *
 * @example
 * await sweepProfileImagePrefix({ userId: `u1`, kind: `profile`, keepUrl: `https://.../profile-xyz.webp` });
 */
async function sweepProfileImagePrefix(args: SweepProfileImagePrefixArgs) {
	// No trailing dash so this also matches any legacy `profiles/{userId}/{kind}.ext` keys
	// that were stored before timestamp suffixes were introduced. The prefix still cannot
	// cross over to the other kind (e.g. `profile` does not match `banner-*`).
	const prefix = `profiles/${args.userId}/${args.kind}`;
	const keepKey = assets.objectKeyFromPublicUrl(args.keepUrl);
	const allKeys = await assets.listObjectKeysByPrefix({ prefix, creds: eventAssetsCreds });
	const orphanKeys = allKeys.filter((key) => key !== keepKey);
	if (!orphanKeys?.length) return;
	await assets.deleteObjects(orphanKeys, eventAssetsCreds);
}

type SweepProfileImagePrefixArgs = {
	userId: string;
	kind: `profile` | `banner`;
	keepUrl: string | null;
};
