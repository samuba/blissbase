import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { deleteObjects, exists, listObjectKeysByPrefix, loadCreds, publicUrl, uploadImageAtObjectKey } from "$lib/assets";
import { sanitizeLocationParams } from "$lib/locationFilter";
import {
	filterOfferingsByIncludeOnline,
	filterOfferingsBySearchTerm,
	shouldIncludeOfferingInLocationFilter,
	type OfferingsFilter,
} from "$lib/offeringsFilter";
import { absoluteUrl } from "$lib/routes";
import { db, s } from "$lib/server/db";
import { resolveOfferingsFilterCoordinates } from "$lib/server/offeringsFilter";
import { hasSocialLink, isPublicProfile } from "$lib/server/profile";
import { CLOUDFLARE_ACCOUNT_ID, S3_ACCESS_KEY_ID, S3_BUCKET_NAME, S3_SECRET_ACCESS_KEY } from "$env/static/private";

const creds = loadCreds({
	S3_ACCESS_KEY_ID,
	S3_SECRET_ACCESS_KEY,
	S3_BUCKET_NAME,
	CLOUDFLARE_ACCOUNT_ID,
});

export const FALLBACK_OFFERINGS_OG_IMAGE = absoluteUrl(`/og-poster-offerings.png`);
export const OFFERINGS_OG_PREFIX = `og/offerings/`;

const warmingKeys = new Set<string>();

/**
 * Loads publicly visible listed offerings for the given list filters.
 */
export async function loadVisibleListedOfferings(filterInput: OfferingsFilter) {
	const sanitized = sanitizeLocationParams({
		location: filterInput.location,
		distance: filterInput.distance,
		lat: filterInput.lat,
		lng: filterInput.lng,
	});
	const filter: OfferingsFilter = {
		location: sanitized.location ?? null,
		distance: sanitized.distance ?? null,
		lat: sanitized.lat ?? null,
		lng: sanitized.lng ?? null,
		searchTerm: filterInput.searchTerm?.trim() || null,
		includeOnline: filterInput.includeOnline ?? true,
	};

	const filterCoords = await resolveOfferingsFilterCoordinates(filter);
	const distanceKm = filter.distance ? parseFloat(filter.distance) : null;

	const offerings = await db.query.offerings.findMany({
		where: eq(s.offerings.listed, true),
		columns: {
			title: true,
			descriptionHtml: true,
			format: true,
			imageUrls: true,
			updatedAt: true,
		},
		with: {
			profile: {
				columns: {
					displayName: true,
					slug: true,
					socialLinks: true,
					latitude: true,
					longitude: true,
				},
			},
		},
		orderBy: (offeringsTable, { desc }) => [desc(offeringsTable.updatedAt)],
	});

	const visible = filterOfferingsBySearchTerm({
		offerings: filterOfferingsByIncludeOnline({
			offerings: offerings.filter((offering) => {
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
			}),
			includeOnline: filter.includeOnline,
		}),
		searchTerm: filter.searchTerm,
	});

	return { filter, offerings: visible };
}

/**
 * Resolves a cached R2 OG URL for a location-specific poster, or returns the
 * static fallback so crawlers never wait on generation.
 */
export async function resolveOfferingsOgImageUrl(filterInput: OfferingsFilter) {
	const locationLabel = offeringsOgLocationLabel(filterInput);
	if (!locationLabel) return FALLBACK_OFFERINGS_OG_IMAGE;

	const objectKey = offeringsOgObjectKey(offeringsOgCacheKey(locationLabel));
	const cachedUrl = publicUrl(objectKey);

	if (await exists(objectKey, creds)) {
		return cachedUrl;
	}

	scheduleOfferingsOgWarm({ objectKey, locationLabel });
	return FALLBACK_OFFERINGS_OG_IMAGE;
}

/** Fire-and-forget warm for a filter (e.g. after admin cache bust). */
export function scheduleOfferingsOgWarmForFilter(filterInput: OfferingsFilter) {
	const locationLabel = offeringsOgLocationLabel(filterInput);
	if (!locationLabel) return;

	const objectKey = offeringsOgObjectKey(offeringsOgCacheKey(locationLabel));
	waitUntil(
		warmOfferingsOgImage({ objectKey, locationLabel }).catch((error) => {
			console.error(`Failed warming offerings OG image for filter:`, error);
		}),
	);
}

/** Deletes every cached offerings OG image from R2. */
export async function bustOfferingsOgImageCache() {
	const keys = await listObjectKeysByPrefix({ prefix: OFFERINGS_OG_PREFIX, creds });
	if (!keys.length) return { deletedCount: 0 };
	await deleteObjects(keys, creds);
	return { deletedCount: keys.length };
}

function scheduleOfferingsOgWarm(args: { objectKey: string; locationLabel: string }) {
	waitUntil(
		warmOfferingsOgImage(args).catch((error) => {
			console.error(`Failed warming offerings OG image:`, error);
		}),
	);
}

async function warmOfferingsOgImage({ objectKey, locationLabel }: { objectKey: string; locationLabel: string }) {
	if (warmingKeys.has(objectKey)) return;
	warmingKeys.add(objectKey);

	try {
		if (await exists(objectKey, creds)) return;

		const { createOfferingsOgImage } = await import(`./offeringsOgImage`);
		const buffer = await createOfferingsOgImage({ locationLabel });
		await uploadImageAtObjectKey(buffer, objectKey, creds, `image/png`);
	} finally {
		warmingKeys.delete(objectKey);
	}
}

function offeringsOgLocationLabel(filterInput: OfferingsFilter) {
	const sanitized = sanitizeLocationParams({
		location: filterInput.location,
		distance: filterInput.distance,
		lat: filterInput.lat,
		lng: filterInput.lng,
	});
	return (sanitized.lat != null && sanitized.lng != null ? sanitized.location : null)?.trim() || sanitized.location?.trim() || null;
}

function offeringsOgCacheKey(locationLabel: string) {
	return createHash(`sha256`).update(locationLabel).digest(`hex`).slice(0, 24);
}

function offeringsOgObjectKey(cacheKey: string) {
	return `${OFFERINGS_OG_PREFIX}${cacheKey}.png`;
}
