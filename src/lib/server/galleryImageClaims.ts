import { dev } from "$app/environment";
import { E2E_TEST } from "$env/static/private";
import * as assets from "$lib/assets";
import { randomString } from "$lib/common";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import {
	assertGalleryImageObject,
	GALLERY_IMAGE_CLAIM_TTL_MS,
	GALLERY_IMAGE_CONTENT_TYPES,
	GALLERY_IMAGE_HEADER_BYTES,
	uniqueGalleryImageClaimTokens,
	type GalleryImageContentType,
	type GalleryImageKind,
} from "$lib/galleryImages";
import { isProcessedImageHash } from "$lib/imageUpload.shared";
import { createHmac, timingSafeEqual } from "node:crypto";

export const isGalleryImageE2eMode = E2E_TEST === `true` && dev;

export async function createGalleryImageUpload(args: {
	kind: GalleryImageKind;
	contentType: GalleryImageContentType;
	hash: string;
}) {
	if (!isProcessedImageHash(args.hash)) throw new Error(`Bild-Upload ist ungültig`);

	const objectKey = assets.galleryTempImageObjectKey({
		kind: args.kind,
		suffix: `${Date.now().toString(36)}-${randomString(8).toLowerCase()}`,
		contentType: args.contentType,
	});
	const claimToken = signGalleryImageClaim({
		objectKey,
		contentType: args.contentType,
		kind: args.kind,
		hash: args.hash,
	});
	if (isGalleryImageE2eMode) {
		return {
			uploadUrl: `/api/test/offering-image-upload`,
			publicUrl: assets.publicUrl(objectKey),
			objectKey,
			claimToken,
		};
	}

	return {
		uploadUrl: await assets.getPresignedPutUrl({ objectKey, creds: eventAssetsCreds }),
		publicUrl: assets.publicUrl(objectKey),
		objectKey,
		claimToken,
	};
}

export function verifyGalleryImageClaims(args: { claimTokens: string[]; kind: GalleryImageKind }) {
	if (!args.claimTokens?.length) return [];
	const uniqueClaimTokens = uniqueGalleryImageClaimTokens(args.claimTokens);
	const verifiedClaims: GalleryImageClaim[] = [];

	for (const claimToken of uniqueClaimTokens) {
		const claim = verifyGalleryImageClaim(claimToken);
		if (claim instanceof Error) return claim;
		if (claim.kind !== args.kind) return new Error(`Bild-Upload ist ungültig`);
		verifiedClaims.push(claim);
	}

	return verifiedClaims;
}

export async function finalizeGalleryImageClaims(args: {
	kind: GalleryImageKind;
	claims: GalleryImageClaim[];
	ownerId: string;
	offeringSlug?: string;
}) {
	if (args.kind === `offering` && !args.offeringSlug?.trim()) throw new Error(`Offering slug cannot be empty`);
	if (!args.claims?.length) return [];
	if (isGalleryImageE2eMode) {
		return args.claims.map((claim) => {
			if (args.kind === `offering`) {
				return `https://assets.blissbase.app/e2e/offerings/${args.ownerId}/${args.offeringSlug}/${claim.hash}.webp`;
			}
			return `https://assets.blissbase.app/e2e/events/${args.ownerId}/${claim.hash}.webp`;
		});
	}

	const imageUrls: string[] = [];
	for (const claim of args.claims) {
		const object = await assets.getObjectPrefix({
			objectKey: claim.objectKey,
			byteLength: GALLERY_IMAGE_HEADER_BYTES,
			creds: eventAssetsCreds,
		});
		assertGalleryImageObject({
			headerBytes: object.bytes,
			size: object.size,
			contentType: claim.contentType,
		});

		imageUrls.push(
			await assets.finalizeGalleryTempImage({
				kind: args.kind,
				tempObjectKey: claim.objectKey,
				finalObjectKey: assets.galleryFinalImageObjectKey({
					kind: args.kind,
					ownerId: args.ownerId,
					suffix: claim.hash,
					contentType: claim.contentType,
					offeringSlug: args.offeringSlug,
				}),
				creds: eventAssetsCreds,
			}),
		);
	}

	return imageUrls;
}

export async function discardGalleryImageUpload(claimToken: string) {
	const claim = verifyGalleryImageClaim(claimToken, { allowExpired: true });
	if (claim instanceof Error) return;
	if (isGalleryImageE2eMode) return;

	try {
		await assets.deleteObjects([claim.objectKey], eventAssetsCreds);
	} catch (err) {
		console.error(`Failed to discard gallery image upload:`, err);
	}
}

export function signGalleryImageClaim(args: {
	objectKey: string;
	contentType: GalleryImageContentType;
	kind: GalleryImageKind;
	hash: string;
}) {
	if (!isProcessedImageHash(args.hash)) throw new Error(`Bild-Upload ist ungültig`);

	const payload = Buffer.from(
		JSON.stringify({
			objectKey: args.objectKey,
			contentType: args.contentType,
			kind: args.kind,
			hash: args.hash,
			expiresAt: Date.now() + GALLERY_IMAGE_CLAIM_TTL_MS,
		} satisfies GalleryImageClaim),
	).toString(`base64url`);
	return `${payload}.${signClaimPayload(payload)}`;
}

function verifyGalleryImageClaim(token: string, args: { allowExpired?: boolean } = {}): GalleryImageClaim | Error {
	const [payload, signature, ...rest] = token.split(`.`);
	if (!payload || !signature || rest.length) return new Error(`Bild-Upload ist ungültig`);
	if (!isValidClaimSignature({ payload, signature })) return new Error(`Bild-Upload ist ungültig`);

	try {
		const claim = JSON.parse(Buffer.from(payload, `base64url`).toString(`utf8`)) as GalleryImageClaim;
		if (!args.allowExpired && claim.expiresAt < Date.now()) return new Error(`Bild-Upload ist abgelaufen`);
		if (!GALLERY_IMAGE_CONTENT_TYPES.includes(claim.contentType)) return new Error(`Bild-Upload ist ungültig`);
		if (claim.kind !== `event` && claim.kind !== `offering`) return new Error(`Bild-Upload ist ungültig`);
		if (typeof claim.hash !== `string` || !isProcessedImageHash(claim.hash)) return new Error(`Bild-Upload ist ungültig`);
		if (!assets.isTempGalleryImageObjectKey({ kind: claim.kind, objectKey: claim.objectKey })) {
			return new Error(`Bild-Upload ist ungültig`);
		}
		return claim;
	} catch {
		return new Error(`Bild-Upload ist ungültig`);
	}
}

function signClaimPayload(payload: string) {
	return createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
}

function isValidClaimSignature(args: { payload: string; signature: string }) {
	const expected = Buffer.from(signClaimPayload(args.payload), `base64url`);
	const submitted = Buffer.from(args.signature, `base64url`);
	if (expected.length !== submitted.length) return false;
	return timingSafeEqual(expected, submitted);
}

export type GalleryImageClaim = {
	objectKey: string;
	contentType: GalleryImageContentType;
	kind: GalleryImageKind;
	hash: string;
	expiresAt: number;
};
