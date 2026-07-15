import * as assets from "$lib/assets";
import { dev } from "$app/environment";
import { E2E_TEST } from "$env/static/private";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { createHmac, timingSafeEqual } from "node:crypto";

const PROFILE_IMAGE_CLAIM_TTL_MS = 1000 * 60 * 60;

/**
 * Converts an empty, existing, final, or signed temporary profile image URL into the final URL to persist.
 *
 * @example
 * const next = await resolveProfileImageUrl({ submittedUrl, currentUrl, userId, expectedType: `profile` });
 */
export async function resolveProfileImageUrl(args: ResolveProfileImageUrlArgs) {
	const submitted = args.submittedUrl?.trim() || ``;
	if (!submitted) return null;
	if (submitted === args.currentUrl) return stripUrlFragment(submitted);

	const expectedPrefix = assets.publicUrl(`profiles/${args.userId}/${args.expectedType}`);
	const submittedUrl = stripUrlFragment(submitted);
	if (submittedUrl.startsWith(expectedPrefix)) return submittedUrl;

	const claim = verifyProfileImageClaimFromUrl({
		submittedUrl: submitted,
		expectedType: args.expectedType,
	});
	if (claim instanceof Error) return claim;

	const suffix = getProfileImageSuffixFromObjectKey({
		objectKey: claim.objectKey,
		expectedType: args.expectedType,
	});
	if (!suffix) return new Error(`Bild-Upload ist ungültig`);

	const finalObjectKey = assets.publicProfileImageObjectKey(args.userId, args.expectedType, claim.contentType, suffix);
	const finalUrl = assets.publicUrl(finalObjectKey);
	if (finalUrl === args.currentUrl) return finalUrl;
	if (E2E_TEST === `true` && dev) return finalUrl;

	try {
		return await assets.finalizeProfileImage({
			tempObjectKey: claim.objectKey,
			finalObjectKey,
			creds: eventAssetsCreds,
		});
	} catch (err) {
		console.error(`Error finalizing profile image:`, err);
		return new Error(`Bild-Upload konnte nicht gespeichert werden`);
	}
}

/**
 * Creates a tamper-evident claim for one temporary profile image upload.
 *
 * @example
 * signProfileImageClaim({ objectKey: `profiles/temp/profile-b.webp`, type: `profile`, contentType: `image/webp` });
 */
export function signProfileImageClaim(args: { objectKey: string; type: ProfileImageType; contentType: ProfileImageContentType }) {
	const payload = encodeClaimPayload({
		objectKey: args.objectKey,
		type: args.type,
		contentType: args.contentType,
		expiresAt: Date.now() + PROFILE_IMAGE_CLAIM_TTL_MS,
	});
	const signature = signClaimPayload(payload);
	return `${payload}.${signature}`;
}

function verifyProfileImageClaimFromUrl(args: { submittedUrl: string; expectedType: ProfileImageType }) {
	const token = getUrlFragment(args.submittedUrl);
	if (!token) return new Error(`Bild-Upload ist ungültig`);

	const claim = verifyProfileImageClaim(token);
	if (claim instanceof Error) return claim;
	if (claim.type !== args.expectedType) return new Error(`Bild-Upload ist ungültig`);

	const submittedObjectKey = assets.objectKeyFromPublicUrl(args.submittedUrl);
	if (submittedObjectKey !== claim.objectKey) return new Error(`Bild-Upload ist ungültig`);

	return claim;
}

function verifyProfileImageClaim(token: string): ProfileImageClaim | Error {
	const [payload, signature, ...rest] = token.split(`.`);
	if (!payload || !signature || rest.length) return new Error(`Bild-Upload ist ungültig`);
	if (!isValidClaimSignature({ payload, signature })) return new Error(`Bild-Upload ist ungültig`);

	try {
		const claim = JSON.parse(Buffer.from(payload, `base64url`).toString(`utf8`)) as ProfileImageClaim;
		if (claim.expiresAt < Date.now()) return new Error(`Bild-Upload ist abgelaufen`);
		if (![`profile`, `banner`].includes(claim.type)) return new Error(`Bild-Upload ist ungültig`);
		if (![`image/webp`, `image/jpeg`].includes(claim.contentType)) return new Error(`Bild-Upload ist ungültig`);
		if (!assets.isTempProfileImageObjectKey(claim.objectKey)) return new Error(`Bild-Upload ist ungültig`);
		if (!claim.objectKey.includes(`/${claim.type}-`)) return new Error(`Bild-Upload ist ungültig`);
		return claim;
	} catch {
		return new Error(`Bild-Upload ist ungültig`);
	}
}

function encodeClaimPayload(claim: ProfileImageClaim) {
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

function stripUrlFragment(url: string) {
	const hashIndex = url.indexOf(`#`);
	if (hashIndex === -1) return url;
	return url.slice(0, hashIndex);
}

function getUrlFragment(url: string) {
	try {
		const parsed = new URL(url);
		return parsed.hash.slice(1) || null;
	} catch {
		const hashIndex = url.indexOf(`#`);
		if (hashIndex === -1) return null;
		return url.slice(hashIndex + 1) || null;
	}
}

function getProfileImageSuffixFromObjectKey(args: { objectKey: string; expectedType: ProfileImageType }) {
	const fileName = args.objectKey.split(`/`).at(-1);
	return fileName?.replace(new RegExp(`^${args.expectedType}-`), ``).replace(/\.(webp|jpg)$/, ``) || null;
}

type ResolveProfileImageUrlArgs = {
	submittedUrl?: string | null;
	currentUrl?: string | null;
	userId: string;
	expectedType: ProfileImageType;
};

type ProfileImageType = "profile" | "banner";

type ProfileImageContentType = `image/webp` | `image/jpeg`;

type ProfileImageClaim = {
	objectKey: string;
	type: ProfileImageType;
	contentType: ProfileImageContentType;
	expiresAt: number;
};
