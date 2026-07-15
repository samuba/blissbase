import { command, form, getRequestEvent, query, requested } from "$app/server";
import { dev } from "$app/environment";
import * as assets from "$lib/assets";
import { randomString, slugify } from "$lib/common";
import { OFFERING_IMAGE_MAX_COUNT, offeringFormSchema, offeringNeedsLocation, updateOfferingFormSchema } from "$lib/rpc/offerings.common";
import { profileLocationFormSchema } from "$lib/rpc/profile.common";
import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import { BASE_URL, routes, safeReturnToPath } from "$lib/routes";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { E2E_TEST } from "$env/static/private";
import { ensureUserId } from "$lib/server/common";
import { and, db, eq, ne, s, sql } from "$lib/server/db";
import { verifyOfferingSubmitAuthToken } from "$lib/server/offeringSubmitAuth";
import { createPublicProfileSlug, hasSocialLink, isPublicProfile } from "$lib/server/profile";
import { resolveProfileImageUrl } from "$lib/server/profileImages";
import type { Profile } from "$lib/server/schema";
import { error, invalid, redirect } from "@sveltejs/kit";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import { setFlash } from "$lib/server/flash";
import type { OfferingsFilter } from "$lib/offeringsFilter";
import { filterOfferingsByIncludeOnline, shouldIncludeOfferingInLocationFilter } from "$lib/offeringsFilter";
import { sanitizeLocationParams, hasValidCoordinates } from "$lib/locationFilter";
import { resolveOfferingsFilterCoordinates } from "$lib/server/offeringsFilter";

const offeringsFilterSchema = v.object({
	location: v.nullable(v.string()),
	distance: v.nullable(v.string()),
	lat: v.nullable(v.number()),
	lng: v.nullable(v.number()),
	searchTerm: v.nullable(v.string()),
	includeOnline: v.boolean(),
});

const offeringImageUploadSchema = v.object({
	contentType: v.picklist([`image/webp`, `image/jpeg`]),
});

const offeringMutationSchema = v.object({
	offeringId: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

const OFFERING_IMAGE_CLAIM_TTL_MS = 1000 * 60 * 60;
const isE2eTestMode = E2E_TEST === `true` && dev;

export const getOfferings = query(offeringsFilterSchema, async (args) => {
	const sanitized = sanitizeLocationParams({
		location: args.location,
		distance: args.distance,
		lat: args.lat,
		lng: args.lng,
	});
	const filter: OfferingsFilter = {
		location: sanitized.location ?? null,
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
			locationLabel: true,
			latitude: true,
			longitude: true,
		},
		with: {
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
			locationLabel: profile.locationLabel ?? ``,
		},
	}));
});

export const userHasOfferings = query(async () => {
	const userId = ensureUserId();
	const offering = await db.query.offerings.findFirst({
		where: eq(s.offerings.profileId, userId),
		columns: {
			id: true,
		},
	});

	return !!offering;
});

export const updateProfileLocation = command(profileLocationFormSchema, async (data) => {
	const userId = ensureUserId();
	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	await db
		.update(s.profiles)
		.set({
			locationLabel: data.locationLabel?.trim() || null,
			latitude: data.latitude ?? null,
			longitude: data.longitude ?? null,
			updatedAt: sql`now()`,
		})
		.where(eq(s.profiles.id, userId));

	getMyPublicProfile().refresh();
	getMyOfferings().refresh();
});

export const createOfferingImageUploadUrl = command(offeringImageUploadSchema, async ({ contentType }) => {
	const objectKey = assets.offeringTempImageObjectKey({
		suffix: `${Date.now().toString(36)}-${randomString(8).toLowerCase()}`,
		contentType,
	});
	const claimToken = signOfferingImageClaim({ objectKey, contentType });
	if (isE2eTestMode) {
		return {
			uploadUrl: `/api/test/offering-image-upload`,
			publicUrl: assets.publicUrl(objectKey),
			objectKey,
			claimToken,
		};
	}

	const uploadUrl = await assets.getPresignedPutUrl({ objectKey, creds: eventAssetsCreds });

	return {
		uploadUrl,
		publicUrl: assets.publicUrl(objectKey),
		objectKey,
		claimToken,
	};
});

export const createOffering = form(offeringFormSchema, async (data, issue) => {
	const sessionUserId = getRequestEvent().locals.userId;
	const userId = sessionUserId ? sessionUserId : verifyOfferingSubmitAuthToken(data.authToken);

	if (!userId) return invalid(issue.email(`Bitte bestätige deine E-Mail erneut.`));

	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	const nextProfile = await mergeProfileFromOfferingForm({
		currentProfile,
		data: data.profile ?? {},
		issue,
	});

	if (!hasSocialLink(nextProfile)) {
		return invalid(issue.profile.socialLinks(`Bitte füge mindestens einen Social-Link hinzu.`));
	}
	if (!isPublicProfile(nextProfile)) {
		return invalid(issue.profile.displayName(`Bitte vervollständige dein öffentliches Profil.`));
	}
	if (offeringNeedsLocation(data.format) && !hasValidCoordinates({ lat: nextProfile.latitude, lng: nextProfile.longitude })) {
		return invalid(issue.profile.locationLabel(`Bitte wähle einen Ort für dein Angebot aus.`));
	}

	const imageClaims = verifyOfferingImageClaims(data.imageClaims);
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	await saveOfferingProfile(nextProfile);

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
	refreshOfferingLists({ returnTo: data.returnTo });
	setFlash(`offeringCreated`);

	redirect(303, routes.offeringDetails(slug));
});

export const updateOffering = form(updateOfferingFormSchema, async (data, issue) => {
	const userId = ensureUserId();
	const offering = await db.query.offerings.findFirst({
		where: and(eq(s.offerings.id, data.offeringId), eq(s.offerings.profileId, userId)),
	});
	if (!offering) throw error(404, `Offering not found`);

	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);
	const nextProfile = data.profile ? await mergeProfileFromOfferingForm({ currentProfile, data: data.profile, issue }) : currentProfile;
	if (offeringNeedsLocation(data.format) && !hasValidCoordinates({ lat: nextProfile.latitude, lng: nextProfile.longitude })) {
		return invalid(issue.profile.locationLabel(`Bitte wähle einen Ort für dein Angebot aus.`));
	}

	const imageClaims = verifyOfferingImageClaims(data.imageClaims);
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	if (data.profile) {
		await saveOfferingProfile(nextProfile);
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

	if (deletedImageUrls?.length && !isE2eTestMode) {
		await assets.deleteObjects(deletedImageUrls, eventAssetsCreds);
	}

	if (!offering.slug) throw error(500, `Offering is missing a slug`);

	getMyPublicProfile().refresh();
	refreshOfferingLists({ returnTo: data.returnTo });
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
	if (offering.imageUrls?.length && !isE2eTestMode) {
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
	if (isE2eTestMode) {
		return args.claims.map((claim, index) => {
			const suffix = getOfferingImageSuffixFromObjectKey(claim.objectKey) ?? `image-${index}`;
			return `https://assets.blissbase.app/e2e/offerings/${args.userId}/${args.offeringId}/${index}-${suffix}.webp`;
		});
	}

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
 * Merges the submitted offering profile patch into the authenticated profile.
 *
 * @example
 * await mergeProfileFromOfferingForm({ currentProfile, data, issue });
 */
async function mergeProfileFromOfferingForm(args: UpdateProfileFromOfferingFormArgs) {
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

async function saveOfferingProfile(profile: Profile) {
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

function refreshOfferingLists(args: { returnTo?: string | null } = {}) {
	const event = getRequestEvent();
	const filterHref = args.returnTo
		? safeReturnToPath({
				returnTo: args.returnTo,
				fallback: routes.offeringsList(),
				origin: event.url.origin,
			})
		: `${event.url.pathname}${event.url.search}`;
	const filterUrl = new URL(filterHref, event.url.origin);
	const offeringsListPath = new URL(routes.offeringsList(), BASE_URL).pathname;

	if (filterUrl.pathname === offeringsListPath) {
		getOfferings(parseOfferingsFilterFromUrl(filterUrl)).refresh();
	}

	void requested(getOfferings, 5).refreshAll();

	if (event.locals.userId) {
		getMyOfferings().refresh();
		userHasOfferings().refresh();
	}
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
