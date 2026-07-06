import { eventAssetsCreds } from "$lib/events.remote.shared";
import { createHmac, timingSafeEqual } from "node:crypto";

const OFFERING_SUBMIT_AUTH_TTL_MS = 1000 * 60 * 10;
const OFFERING_SUBMIT_AUTH_PURPOSE = `create-offering`;

/**
 * Creates a short-lived token that lets the just-verified OTP flow finish creating an offering.
 *
 * @example
 * const token = signOfferingSubmitAuthToken({ userId: `user-123` });
 */
export function signOfferingSubmitAuthToken(args: { userId: string }) {
	const payload = encodePayload({
		purpose: OFFERING_SUBMIT_AUTH_PURPOSE,
		userId: args.userId,
		expiresAt: Date.now() + OFFERING_SUBMIT_AUTH_TTL_MS,
	});
	const signature = signPayload(payload);
	return `${payload}.${signature}`;
}

/**
 * Verifies a short-lived offering submit token and returns the authenticated user id.
 *
 * @example
 * const userId = verifyOfferingSubmitAuthToken(token);
 */
export function verifyOfferingSubmitAuthToken(token: string | null | undefined) {
	const [payload, signature, ...rest] = (token ?? ``).split(`.`);
	if (!payload || !signature || rest.length) return null;
	if (!isValidSignature({ payload, signature })) return null;

	try {
		const claim = JSON.parse(Buffer.from(payload, `base64url`).toString(`utf8`)) as OfferingSubmitAuthClaim;
		if (claim.purpose !== OFFERING_SUBMIT_AUTH_PURPOSE) return null;
		if (!claim.userId?.trim()) return null;
		if (claim.expiresAt < Date.now()) return null;
		return claim.userId;
	} catch {
		return null;
	}
}

function encodePayload(claim: OfferingSubmitAuthClaim) {
	return Buffer.from(JSON.stringify(claim)).toString(`base64url`);
}

function signPayload(payload: string) {
	return createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
}

function isValidSignature(args: { payload: string; signature: string }) {
	const expectedSignature = signPayload(args.payload);
	const expected = Buffer.from(expectedSignature, `base64url`);
	const submitted = Buffer.from(args.signature, `base64url`);
	if (expected.length !== submitted.length) return false;
	return timingSafeEqual(expected, submitted);
}

type OfferingSubmitAuthClaim = {
	purpose: typeof OFFERING_SUBMIT_AUTH_PURPOSE;
	userId: string;
	expiresAt: number;
};
