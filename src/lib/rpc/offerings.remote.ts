import { command, form, getRequestEvent, query } from "$app/server";
import * as assets from "$lib/assets";
import { randomString, slugify } from "$lib/common";
import {
	OFFERING_IMAGE_MAX_COUNT,
	OFFERING_PLACE_FILTERS,
	offeringFormSchema,
	updateOfferingFormSchema,
	type OfferingFormat,
} from "$lib/rpc/offerings.common";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import { routes } from "$lib/routes";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { E2E_TEST } from "$env/static/private";
import { ensureUserId } from "$lib/server/common";
import { and, db, eq, ne, s, sql } from "$lib/server/db";
import { verifyOfferingSubmitAuthToken } from "$lib/server/offeringSubmitAuth";
import { createPublicProfileSlug, isPublicProfile } from "$lib/server/profile";
import { resolveProfileImageUrl } from "$lib/server/profileImages";
import type { Profile } from "$lib/server/schema";
import { error, invalid, redirect } from "@sveltejs/kit";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import { setFlash } from "$lib/server/flash";

const placeFilterSchema = v.object({
	filter: v.optional(v.picklist(OFFERING_PLACE_FILTERS), `online`),
});

const offeringImageUploadSchema = v.object({
	contentType: v.picklist([`image/webp`, `image/jpeg`]),
});

const offeringMutationSchema = v.object({
	offeringId: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

const OFFERING_IMAGE_CLAIM_TTL_MS = 1000 * 60 * 60;

export const getOfferings = query(placeFilterSchema, async ({ filter }) => {
	const currentUserId = getRequestEvent().locals.userId;
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
				},
				with: {
					place: {
						columns: {
							name: true,
							slug: true,
						},
					},
				},
			},
		},
		orderBy: (offerings, { desc }) => [desc(offerings.createdAt)],
	});

	return {
		filter,
		offerings: offerings
			.filter((offering) => {
				if (!offering.profile || !isPublicProfile(offering.profile)) return false;
				if (!hasSocialLink(offering.profile)) return false;
				if (filter === `online`) return isOnlineOffering(offering.format);
				if (!isOfflineOffering(offering.format)) return false;
				if (filter === `danang`) return offering.profile.place?.slug === `danang`;
				if (filter === `hoi-an`) return offering.profile.place?.slug === `hoi-an`;
				return [`danang`, `hoi-an`].includes(offering.profile.place?.slug ?? ``);
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
				},
				canManage: currentUserId === offering.profile.id,
			})),
	};
});

export const getMyOfferings = query(async () => {
	const userId = ensureUserId();
	const profile = await db.query.profiles.findFirst({
		where: eq(s.profiles.id, userId),
		columns: {
			slug: true,
			displayName: true,
			bio: true,
			profileImageUrl: true,
			bannerImageUrl: true,
			socialLinks: true,
		},
		with: {
			place: {
				columns: {
					name: true,
					slug: true,
				},
			},
			offerings: {
				columns: {
					id: true,
					slug: true,
					title: true,
					descriptionHtml: true,
					format: true,
					imageUrls: true,
					listed: true,
				},
				orderBy: (offerings, { desc }) => [desc(offerings.createdAt)],
			},
		},
	});
	if (!profile) return [];

	return profile.offerings.map((offering) => ({
		...offering,
		descriptionHtml: offering.descriptionHtml ?? ``,
		imageUrls: offering.imageUrls ?? [],
		canManage: true,
		profile: {
			...profile,
			bio: profile.bio ?? ``,
			profileImageUrl: profile.profileImageUrl ?? ``,
			bannerImageUrl: profile.bannerImageUrl ?? ``,
		},
	}));
});

export const createOfferingImageUploadUrl = command(offeringImageUploadSchema, async ({ contentType }) => {
	const objectKey = assets.offeringTempImageObjectKey({
		suffix: `${Date.now().toString(36)}-${randomString(8).toLowerCase()}`,
		contentType,
	});
	const uploadUrl = await assets.getPresignedPutUrl({ objectKey, creds: eventAssetsCreds });

	return {
		uploadUrl,
		publicUrl: assets.publicUrl(objectKey),
		objectKey,
		claimToken: signOfferingImageClaim({ objectKey, contentType }),
	};
});

export const createOffering = form(offeringFormSchema, async (data, issue) => {
	const userId = getOfferingSubmitUserId(data.authToken);
	if (!userId) return invalid(issue.email(`Bitte bestätige deine E-Mail erneut.`));

	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	const nextProfile = data.profile
		? await updateProfileFromOfferingForm({ currentProfile, data: data.profile, issue })
		: await ensureOfferingProfileSlug(currentProfile);

	if (!hasSocialLink(nextProfile)) {
		return invalid(issue.profile.socialLinks(`Bitte füge mindestens einen Social-Link hinzu.`));
	}
	if (!isPublicProfile(nextProfile)) {
		return invalid(issue.profile.displayName(`Bitte vervollständige dein öffentliches Profil.`));
	}

	const imageClaims = verifyOfferingImageClaims(data.imageClaims);
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	const slug = `${randomString(6).toLowerCase()}-${slugify(data.title)}`;

	const [offering] = await db
		.insert(s.offerings)
		.values({
			profileId: userId,
			slug,
			title: data.title,
			descriptionHtml: data.descriptionHtml || null,
			format: data.format,
			imageUrls: [],
			listed: true,
		})
		.returning({ id: s.offerings.id });
	if (!offering) throw error(500, `Failed to create offering`);

	const imageUrls = await finalizeOfferingImageClaims({
		claims: imageClaims,
		userId,
		offeringId: offering.id,
	});
	if (imageUrls.length) {
		await db
			.update(s.offerings)
			.set({
				imageUrls,
				updatedAt: sql`now()`,
			})
			.where(eq(s.offerings.id, offering.id));
	}

	getMyPublicProfile().refresh();
	refreshOfferingLists();
	setFlash(`offeringCreated`);

	redirect(
		303,
		routes.offeringDetails(slug),
	);
});

export const updateOffering = form(updateOfferingFormSchema, async (data, issue) => {
	const userId = ensureUserId();
	const offering = await db.query.offerings.findFirst({
		where: and(eq(s.offerings.id, data.offeringId), eq(s.offerings.profileId, userId)),
		with: {
			profile: {
				columns: {
					placeId: true,
				},
			},
		},
	});
	if (!offering) throw error(404, `Offering not found`);

	const imageClaims = verifyOfferingImageClaims(data.imageClaims);
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	const uploadedImageUrls = await finalizeOfferingImageClaims({
		claims: imageClaims,
		userId,
		offeringId: offering.id,
	});
	const submittedClaimTokens = getUniqueOfferingImageClaimTokens(data.imageClaims);
	const nextImageUrls = getNextOfferingImageUrls({
		currentImageUrls: offering.imageUrls ?? [],
		submittedImageUrls: data.existingImageUrls,
		submittedClaimTokens,
		uploadedImageUrls,
		imageOrder: data.imageOrder,
	});
	const deletedImageUrls = (offering.imageUrls ?? []).filter((url) => !nextImageUrls.includes(url));

	await db
		.update(s.offerings)
		.set({
			title: data.title,
			descriptionHtml: data.descriptionHtml || null,
			format: data.format,
			imageUrls: nextImageUrls,
			updatedAt: sql`now()`,
		})
		.where(and(eq(s.offerings.id, offering.id), eq(s.offerings.profileId, userId)));

	if (deletedImageUrls?.length && E2E_TEST !== `true`) {
		await assets.deleteObjects(deletedImageUrls, eventAssetsCreds);
	}

	if (!offering.slug) throw error(500, `Offering is missing a slug`);

	refreshOfferingLists();
	redirect(
		303,
		routes.offeringDetails(offering.slug),
	);
});

export const unlistOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const userId = ensureUserId();
	const [offering] = await db
		.update(s.offerings)
		.set({
			listed: false,
			updatedAt: sql`now()`,
		})
		.where(and(eq(s.offerings.id, offeringId), eq(s.offerings.profileId, userId)))
		.returning({ id: s.offerings.id });

	if (!offering) throw error(404, `Offering not found`);
	refreshOfferingLists();
	setFlash(`offeringUnlisted`);

	return { success: true };
});

export const listOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const userId = ensureUserId();
	const [offering] = await db
		.update(s.offerings)
		.set({
			listed: true,
			updatedAt: sql`now()`,
		})
		.where(and(eq(s.offerings.id, offeringId), eq(s.offerings.profileId, userId)))
		.returning({ id: s.offerings.id });

	if (!offering) throw error(404, `Offering not found`);
	refreshOfferingLists();
	setFlash(`offeringListed`);

	return { success: true };
});

export const deleteOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const userId = ensureUserId();
	const [offering] = await db
		.delete(s.offerings)
		.where(and(eq(s.offerings.id, offeringId), eq(s.offerings.profileId, userId)))
		.returning({ id: s.offerings.id, imageUrls: s.offerings.imageUrls });

	if (!offering) throw error(404, `Offering not found`);
	if (offering.imageUrls?.length && E2E_TEST !== `true`) {
		await assets.deleteObjects(offering.imageUrls, eventAssetsCreds);
	}

	refreshOfferingLists();
	setFlash(`offeringDeleted`);

	return { success: true };
});

/**
 * Verifies and moves temporary offering image uploads into the final offering prefix.
 *
 * @example
 * await finalizeOfferingImageClaims({ claims: [], userId: `u1`, offeringId: 1 });
 */
async function finalizeOfferingImageClaims(args: FinalizeOfferingImageClaimsArgs) {
	if (!args.claims?.length) return [];
	const imageUrls: string[] = [];
	for (const claim of args.claims) {
		const suffix = getOfferingImageSuffixFromObjectKey(claim.objectKey);
		if (!suffix) throw error(400, `Bild-Upload ist ungültig`);

		const finalObjectKey = assets.offeringImageObjectKey({
			userId: args.userId,
			offeringId: args.offeringId,
			suffix,
			contentType: claim.contentType,
		});
		const imageUrl = await assets.finalizeOfferingImage({
			tempObjectKey: claim.objectKey,
			finalObjectKey,
			creds: eventAssetsCreds,
		});
		imageUrls.push(imageUrl);
	}

	return imageUrls;
}

function verifyOfferingImageClaims(claimTokens: string[]) {
	if (!claimTokens?.length) return [];
	const uniqueClaimTokens = getUniqueOfferingImageClaimTokens(claimTokens);
	const verifiedClaims: OfferingImageClaim[] = [];

	for (const claimToken of uniqueClaimTokens) {
		const claim = verifyOfferingImageClaim(claimToken);
		if (claim instanceof Error) return claim;
		verifiedClaims.push(claim);
	}

	return verifiedClaims;
}

function getUniqueOfferingImageClaimTokens(claimTokens: string[]) {
	return [...new Set(claimTokens ?? [])].slice(0, OFFERING_IMAGE_MAX_COUNT);
}

/**
 * Creates a tamper-evident claim for one temporary offering image upload.
 *
 * @example
 * signOfferingImageClaim({ objectKey: `offerings/temp/b.webp`, contentType: `image/webp` });
 */
function signOfferingImageClaim(args: { objectKey: string; contentType: OfferingImageContentType }) {
	const payload = encodeClaimPayload({
		objectKey: args.objectKey,
		contentType: args.contentType,
		expiresAt: Date.now() + OFFERING_IMAGE_CLAIM_TTL_MS,
	});
	const signature = signClaimPayload(payload);
	return `${payload}.${signature}`;
}

function verifyOfferingImageClaim(token: string): OfferingImageClaim | Error {
	const [payload, signature, ...rest] = token.split(`.`);
	if (!payload || !signature || rest.length) return new Error(`Bild-Upload ist ungültig`);
	if (!isValidClaimSignature({ payload, signature })) return new Error(`Bild-Upload ist ungültig`);

	try {
		const claim = JSON.parse(Buffer.from(payload, `base64url`).toString(`utf8`)) as OfferingImageClaim;
		if (claim.expiresAt < Date.now()) return new Error(`Bild-Upload ist abgelaufen`);
		if (![`image/webp`, `image/jpeg`].includes(claim.contentType)) return new Error(`Bild-Upload ist ungültig`);
		if (!assets.isTempOfferingImageObjectKey(claim.objectKey)) return new Error(`Bild-Upload ist ungültig`);
		return claim;
	} catch {
		return new Error(`Bild-Upload ist ungültig`);
	}
}

function encodeClaimPayload(claim: OfferingImageClaim) {
	return Buffer.from(JSON.stringify(claim)).toString(`base64url`);
}

function signClaimPayload(payload: string) {
	return createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
}

function isValidClaimSignature(args: { payload: string; signature: string }) {
	const expectedSignature = signClaimPayload(args.payload);
	const expected = Buffer.from(expectedSignature, `base64url`);
	const submitted = Buffer.from(args.signature, `base64url`);
	if (expected.length !== submitted.length) return false;
	return timingSafeEqual(expected, submitted);
}

function getOfferingImageSuffixFromObjectKey(objectKey: string) {
	const fileName = objectKey.split(`/`).at(-1);
	return fileName?.replace(/\.(webp|jpg)$/, ``);
}

/**
 * Updates only the profile fields collected during offering onboarding.
 *
 * @example
 * await updateProfileFromOfferingForm({ currentProfile, data, issue });
 */
async function updateProfileFromOfferingForm(args: UpdateProfileFromOfferingFormArgs) {
	const currentSlug = args.currentProfile.slug?.trim();
	const slug =
		currentSlug ||
		(await createAvailableProfileSlug({
			displayName: args.data.displayName,
			profileId: args.currentProfile.id,
		}));

	const nextProfileImageUrl = await resolveProfileImageUrl({
		submittedUrl: args.data.profileImageUrl,
		currentUrl: args.currentProfile.profileImageUrl,
		userId: args.currentProfile.id,
		expectedType: `profile`,
	});
	if (nextProfileImageUrl instanceof Error) {
		return invalid(args.issue.profile.profileImageUrl(nextProfileImageUrl.message));
	}

	const nextBannerImageUrl = await resolveProfileImageUrl({
		submittedUrl: args.data.bannerImageUrl,
		currentUrl: args.currentProfile.bannerImageUrl,
		userId: args.currentProfile.id,
		expectedType: `banner`,
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
			updatedAt: sql`now()`,
		})
		.where(eq(s.profiles.id, args.currentProfile.id))
		.returning();

	await Promise.all([
		sweepProfileImagePrefix({
			userId: args.currentProfile.id,
			kind: `profile`,
			keepUrl: nextProfileImageUrl,
		}),
		sweepProfileImagePrefix({
			userId: args.currentProfile.id,
			kind: `banner`,
			keepUrl: nextBannerImageUrl,
		}),
	]);

	return updatedProfile;
}

async function ensureOfferingProfileSlug(profile: Profile) {
	if (profile.slug?.trim()) return profile;
	const slug = await createAvailableProfileSlug({
		displayName: profile.displayName ?? `profile`,
		profileId: profile.id,
	});

	const [updatedProfile] = await db
		.update(s.profiles)
		.set({
			slug,
			updatedAt: sql`now()`,
		})
		.where(eq(s.profiles.id, profile.id))
		.returning();

	return updatedProfile ?? profile;
}

async function createAvailableProfileSlug(args: { displayName: string; profileId: string }) {
	const baseSlug = createPublicProfileSlug({ displayName: args.displayName }) || `profile`;
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

function isOnlineOffering(format: OfferingFormat) {
	return format === `online` || format === `offline+online`;
}

function isOfflineOffering(format: OfferingFormat) {
	return format === `offline` || format === `offline+online`;
}

function hasSocialLink(profile: Pick<Profile, "socialLinks"> | null | undefined) {
	return Boolean(profile?.socialLinks?.some((link) => link.value?.trim()));
}

function keepSubmittedOfferingImages(args: { currentImageUrls: string[]; submittedImageUrls: string[] }) {
	if (!args.currentImageUrls?.length || !args.submittedImageUrls?.length) return [];

	const currentUrls = new Set(args.currentImageUrls);
	const keptUrls = new Set<string>();
	return args.submittedImageUrls.filter((url) => {
		if (!currentUrls.has(url)) return false;
		if (keptUrls.has(url)) return false;
		keptUrls.add(url);
		return true;
	});
}

function getNextOfferingImageUrls(args: {
	currentImageUrls: string[];
	submittedImageUrls: string[];
	submittedClaimTokens: string[];
	uploadedImageUrls: string[];
	imageOrder: string[];
}) {
	const existingImageUrls = keepSubmittedOfferingImages({
		currentImageUrls: args.currentImageUrls,
		submittedImageUrls: args.submittedImageUrls,
	});
	const existingUrls = new Set(existingImageUrls);
	const uploadedUrlByClaimToken = new Map(
		args.submittedClaimTokens.flatMap((token, index) => {
			const url = args.uploadedImageUrls[index];
			if (!url) return [];
			return [[token, url] as const];
		}),
	);
	const nextImageUrls: string[] = [];

	for (const token of args.imageOrder) {
		if (existingUrls.has(token)) {
			addUniqueImageUrl({ imageUrls: nextImageUrls, url: token });
			continue;
		}

		const uploadedUrl = uploadedUrlByClaimToken.get(token);
		if (uploadedUrl) {
			addUniqueImageUrl({ imageUrls: nextImageUrls, url: uploadedUrl });
		}
	}

	for (const url of existingImageUrls) {
		addUniqueImageUrl({ imageUrls: nextImageUrls, url });
	}
	for (const token of args.submittedClaimTokens) {
		const uploadedUrl = uploadedUrlByClaimToken.get(token);
		if (uploadedUrl) {
			addUniqueImageUrl({ imageUrls: nextImageUrls, url: uploadedUrl });
		}
	}

	return nextImageUrls.slice(0, OFFERING_IMAGE_MAX_COUNT);
}

function addUniqueImageUrl(args: { imageUrls: string[]; url: string }) {
	if (args.imageUrls.includes(args.url)) return;
	args.imageUrls.push(args.url);
}

function refreshOfferingLists() {
	for (const filter of OFFERING_PLACE_FILTERS) {
		getOfferings({ filter }).refresh();
	}
	if (getRequestEvent().locals.userId) {
		getMyOfferings().refresh();
	}
}

function getOfferingSubmitUserId(authToken: string | undefined) {
	const sessionUserId = getRequestEvent().locals.userId;
	if (sessionUserId) return sessionUserId;
	return verifyOfferingSubmitAuthToken(authToken);
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
	data: NonNullable<v.InferOutput<typeof offeringFormSchema>["profile"]>;
	issue: OfferingFormIssue;
};

type OfferingFormIssue = {
	profile: {
		profileImageUrl: (message: string) => InvalidIssue;
		bannerImageUrl: (message: string) => InvalidIssue;
	};
};

type InvalidIssue = Parameters<typeof invalid>[0];

type SweepProfileImagePrefixArgs = {
	userId: string;
	kind: `profile` | `banner`;
	keepUrl: string | null;
};

type FinalizeOfferingImageClaimsArgs = {
	claims: OfferingImageClaim[];
	userId: string;
	offeringId: number;
};

type OfferingImageContentType = `image/webp` | `image/jpeg`;

type OfferingImageClaim = {
	objectKey: string;
	contentType: OfferingImageContentType;
	expiresAt: number;
};
