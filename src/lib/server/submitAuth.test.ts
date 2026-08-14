import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { signSubmitAuthToken, verifySubmitAuthToken } from "$lib/server/submitAuth";

describe(`submitAuth`, () => {
	it(`round-trips a signed user id`, () => {
		const token = signSubmitAuthToken({ userId: `user-123` });
		expect(verifySubmitAuthToken(token)).toBe(`user-123`);
	});

	it(`rejects a tampered token`, () => {
		const token = signSubmitAuthToken({ userId: `user-123` });
		const [payload] = token.split(`.`);
		expect(verifySubmitAuthToken(`${payload}.not-a-signature`)).toBeNull();
	});

	it(`rejects a token with the old offering purpose`, () => {
		const payload = Buffer.from(
			JSON.stringify({
				purpose: `create-offering`,
				userId: `user-123`,
				expiresAt: Date.now() + 60_000,
			}),
		).toString(`base64url`);
		const signature = createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
		expect(verifySubmitAuthToken(`${payload}.${signature}`)).toBeNull();
	});

	it(`rejects an expired token`, () => {
		const payload = Buffer.from(
			JSON.stringify({
				purpose: `post-otp-submit`,
				userId: `user-123`,
				expiresAt: Date.now() - 1000,
			}),
		).toString(`base64url`);
		const signature = createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
		expect(verifySubmitAuthToken(`${payload}.${signature}`)).toBeNull();
	});
});
