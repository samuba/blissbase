import { command, form, getRequestEvent, query, requested } from "$app/server";
import * as assets from "$lib/assets";
import { randomString, slugify } from "$lib/common";
import { offeringFormSchema, offeringNeedsLocation, sortOfferingsForDailyList, updateOfferingFormSchema } from "$lib/rpc/offerings.common";
import { getNextGalleryImageUrls, uniqueGalleryImageClaimTokens } from "$lib/galleryImages";
import { finalizeGalleryImageClaims, isGalleryImageE2eMode, verifyGalleryImageClaims } from "$lib/server/galleryImageClaims";
import { profileLocationFormSchema } from "$lib/rpc/profile.common";
import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import { BASE_URL, routes, safeReturnToPath, withOfferingSlug } from "$lib/routes";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { ensureUserId } from "$lib/server/common";
import { and, db, eq, or, s, sql } from "$lib/server/db";
import { verifySubmitAuthToken } from "$lib/server/submitAuth";
import { hasSocialLink, isPublicProfile } from "$lib/server/profile";
import { mergeProfileFromForm, savePublicProfile } from "$lib/server/savePublicProfile";
import { error, invalid, redirect } from "@sveltejs/kit";
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

const offeringMutationSchema = v.object({
	offeringId: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

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

	const imageClaims = verifyGalleryImageClaims({ claimTokens: data.imageClaims, kind: `offering` });
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	await savePublicProfile(nextProfile);

	const slug = `${randomString(6).toLowerCase()}-${slugify(data.title)}`;
	const imageUrls = await finalizeGalleryImageClaims({
		kind: `offering`,
		claims: imageClaims,
		ownerId: userId,
		offeringSlug: slug,
	});

	const [offering] = await db
		.insert(s.offerings)
		.values({
			profileId: userId,
			slug,
			title: data.title,
			descriptionHtml: data.descriptionHtml || null,
			format: data.format,
			imageUrls,
			listed: true,
		})
		.returning({ id: s.offerings.id });
	if (!offering) throw error(500, `Failed to create offering`);

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

	const imageClaims = verifyGalleryImageClaims({ claimTokens: data.imageClaims, kind: `offering` });
	if (imageClaims instanceof Error) {
		return invalid(issue.imageClaims(imageClaims.message));
	}

	if (data.profile) {
		await savePublicProfile(nextProfile);
	}

	if (!offering.slug) throw error(500, `Offering is missing a slug`);

	const uploadedImageUrls = await finalizeGalleryImageClaims({
		kind: `offering`,
		claims: imageClaims,
		ownerId: ownerId,
		offeringSlug: offering.slug,
	});
	const nextImageUrls = getNextGalleryImageUrls({
		currentImageUrls: offering.imageUrls ?? [],
		submittedImageUrls: data.existingImageUrls,
		submittedClaimTokens: uniqueGalleryImageClaimTokens(data.imageClaims),
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

	if (deletedImageUrls?.length && !isGalleryImageE2eMode) {
		await assets.deleteObjects(deletedImageUrls, eventAssetsCreds);
	}

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
	if (offering.imageUrls?.length && !isGalleryImageE2eMode) {
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
