import { command, form, getRequestEvent, query, requested } from "$app/server";
import { dev } from "$app/environment";
import * as assets from "$lib/assets";
import { randomString, slugify } from "$lib/common";
import { OFFERING_IMAGE_MAX_COUNT, offeringFormSchema, offeringNeedsLocation, updateOfferingFormSchema } from "$lib/rpc/offerings.common";
import { profileLocationFormSchema } from "$lib/rpc/profile.common";
import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import { BASE_URL, routes, safeReturnToPath, withOfferingSlug } from "$lib/routes";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { E2E_TEST } from "$env/static/private";
import { ensureUserId } from "$lib/server/common";
import { and, db, eq, or, s, sql } from "$lib/server/db";
import { verifySubmitAuthToken } from "$lib/server/submitAuth";
import { hasSocialLink, isPublicProfile } from "$lib/server/profile";
import { mergeProfileFromForm, savePublicProfile } from "$lib/server/savePublicProfile";
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
		includeOnline: args.includeOnline ?? true,
	};
	const { userId, isAdminSession } = getRequestEvent().locals;
	const filterCoords = await resolveOfferingsFilterCoordinates(filter);
	const distanceKm = filter.distance ? parseFloat(filter.distance) : null;

	const offerings = await db.query.offerings.findMany({
		where: userId
			? or(eq(s.offerings.listed, true), eq(s.offerings.profileId, userId))
			: eq(s.offerings.listed, true),
		columns: {
			id: true,
			slug: true,
			title: true,
			descriptionHtml: true,
			format: true,
			imageUrls: true,
			listed: true,
			createdAt: true,
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

	return {
		filter,
		offerings: sortOfferingsForDailyList(
			filterOfferingsByIncludeOnline({
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
						canManage: userId === offering.profile.id || isAdminSession,
					})),
				includeOnline: filter.includeOnline,
			}),
		),
	};
});

export const getOfferingBySlug = query(
	v.object({
		slug: v.pipe(v.string(), v.trim(), v.nonEmpty()),
	}),
	async ({ slug }) => {
		const currentUserId = getRequestEvent().locals.userId;
		const isAdminSession = getRequestEvent().locals.isAdminSession;
		const offering = await db.query.offerings.findFirst({
			where: currentUserId
				? and(eq(s.offerings.slug, slug), or(eq(s.offerings.listed, true), eq(s.offerings.profileId, currentUserId)))
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
		if (!offering?.profile) return null;

		return {
			...offering,
			descriptionHtml: offering.descriptionHtml ?? ``,
			imageUrls: offering.imageUrls ?? [],
			canManage: currentUserId === offering.profile.id || isAdminSession,
			profile: {
				...offering.profile,
				bio: offering.profile.bio ?? ``,
				profileImageUrl: offering.profile.profileImageUrl ?? ``,
				bannerImageUrl: offering.profile.bannerImageUrl ?? ``,
				locationLabel: offering.profile.locationLabel ?? ``,
			},
		};
	},
);

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
	const userId = sessionUserId ? sessionUserId : verifySubmitAuthToken(data.authToken);

	if (!userId) return invalid(issue.email(`Bitte bestätige deine E-Mail erneut.`));

	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);

	const nextProfile = await mergeProfileFromForm({
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

	await savePublicProfile(nextProfile);

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

	redirect(
		303,
		withOfferingSlug({
			path: safeReturnToPath({
				returnTo: data.returnTo,
				fallback: routes.offeringsList(),
			}),
			offeringSlug: slug,
		}),
	);
});

export const updateOffering = form(updateOfferingFormSchema, async (data, issue) => {
	const offering = await assertOfferingExists(data.offeringId);
	assertCanManageOffering(offering);

	const ownerId = offering.profileId;
	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, ownerId) });
	if (!currentProfile) throw error(404, `Profile not found`);
	const nextProfile = data.profile ? await mergeProfileFromForm({ currentProfile, data: data.profile, issue }) : currentProfile;
	if (offeringNeedsLocation(data.format) && !hasValidCoordinates({ lat: nextProfile.latitude, lng: nextProfile.longitude })) {
		return invalid(issue.profile.locationLabel(`Bitte wähle einen Ort für dein Angebot aus.`));
	}

	const imageClaims = verifyOfferingImageClaims(data.imageClaims);
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	if (data.profile) {
		await savePublicProfile(nextProfile);
	}

	const uploadedImageUrls = await finalizeOfferingImageClaims({
		claims: imageClaims,
		userId: ownerId,
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
		.where(eq(s.offerings.id, offering.id));

	if (deletedImageUrls?.length && !isE2eTestMode) {
		await assets.deleteObjects(deletedImageUrls, eventAssetsCreds);
	}

	if (!offering.slug) throw error(500, `Offering is missing a slug`);

	getMyPublicProfile().refresh();
	refreshOfferingLists({ returnTo: data.returnTo });
});

export const unlistOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const existing = await assertOfferingExists(offeringId);
	assertCanManageOffering(existing);

	const [offering] = await db
		.update(s.offerings)
		.set({
			listed: false,
			updatedAt: sql`now()`,
		})
		.where(eq(s.offerings.id, offeringId))
		.returning({ id: s.offerings.id });

	if (!offering) throw error(404, `Offering not found`);
	refreshOfferingLists();
	setFlash(`offeringUnlisted`);

	return { success: true };
});

export const listOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const existing = await assertOfferingExists(offeringId);
	assertCanManageOffering(existing);

	const [offering] = await db
		.update(s.offerings)
		.set({
			listed: true,
			updatedAt: sql`now()`,
		})
		.where(eq(s.offerings.id, offeringId))
		.returning({ id: s.offerings.id });

	if (!offering) throw error(404, `Offering not found`);
	refreshOfferingLists();
	setFlash(`offeringListed`);

	return { success: true };
});

export const deleteOffering = command(offeringMutationSchema, async ({ offeringId }) => {
	const existing = await assertOfferingExists(offeringId);
	assertCanManageOffering(existing);

	const [offering] = await db
		.delete(s.offerings)
		.where(eq(s.offerings.id, offeringId))
		.returning({ id: s.offerings.id, imageUrls: s.offerings.imageUrls });

	if (!offering) throw error(404, `Offering not found`);
	if (offering.imageUrls?.length && !isE2eTestMode) {
		await assets.deleteObjects(offering.imageUrls, eventAssetsCreds);
	}

	refreshOfferingLists();
	setFlash(`offeringDeleted`);

	return { success: true };
});

async function assertOfferingExists(offeringId: number) {
	const offering = await db.query.offerings.findFirst({
		where: eq(s.offerings.id, offeringId),
	});
	if (!offering) throw error(404, `Offering not found`);
	return offering;
}

function assertCanManageOffering(offering: { profileId: string }) {
	const userId = ensureUserId();
	if (userId === offering.profileId || getRequestEvent().locals.isAdminSession) return;
	throw error(403, `You are not allowed to manage this offering`);
}

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

/**
 * Stable per-day offering order: same-day creations stay on top (newest first),
 * everything else is a deterministic shuffle for that Berlin calendar day.
 */
export function sortOfferingsForDailyList<T extends { id: number; createdAt: Date }>(
	offerings: T[],
	now = new Date(),
) {
	if (!offerings?.length) return [];

	const todayKey = berlinDayKey(now);
	return [...offerings].sort((a, b) => {
		const aIsNew = berlinDayKey(a.createdAt) === todayKey;
		const bIsNew = berlinDayKey(b.createdAt) === todayKey;
		if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;

		if (aIsNew) {
			const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
			if (createdDiff !== 0) return createdDiff;
			return b.id - a.id;
		}

		const rankDiff = dailyShuffleRank({ id: a.id, day: todayKey }) - dailyShuffleRank({ id: b.id, day: todayKey });
		if (rankDiff !== 0) return rankDiff;
		return a.id - b.id;
	});
}

function berlinDayKey(date: Date) {
	return date.toLocaleDateString(`en-CA`, { timeZone: `Europe/Berlin` });
}

function dailyShuffleRank({ id, day }: { id: number; day: string }) {
	let hash = 2166136261;
	const input = `${day}:${id}`;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

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
