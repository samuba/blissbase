import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(`$app/environment`, () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { deleteObjects, finalizeGalleryTempImage, getObjectPrefix, getPresignedPutUrl } = vi.hoisted(() => ({
	deleteObjects: vi.fn(async () => []),
	finalizeGalleryTempImage: vi.fn(async (args: { finalObjectKey: string }) => `https://assets.blissbase.app/${args.finalObjectKey}`),
	getObjectPrefix: vi.fn(async () => ({
		bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
		size: 12,
	})),
	getPresignedPutUrl: vi.fn(async () => `https://upload.example/put`),
}));

vi.mock(`$lib/assets`, async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/assets")>();
	return {
		...actual,
		deleteObjects,
		finalizeGalleryTempImage,
		getObjectPrefix,
		getPresignedPutUrl,
	};
});

import { eventAssetsCreds } from "$lib/events.remote.shared";
import {
	createGalleryImageUpload,
	discardGalleryImageUpload,
	finalizeGalleryImageClaims,
	signGalleryImageClaim,
	verifyGalleryImageClaims,
} from "$lib/server/galleryImageClaims";

describe(`verifyGalleryImageClaims`, () => {
	it(`returns an empty list when no tokens are submitted`, () => {
		expect(verifyGalleryImageClaims({ claimTokens: [], kind: `event` })).toEqual([]);
	});

	it(`round-trips a signed event claim`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});

		expect(verifyGalleryImageClaims({ claimTokens: [token], kind: `event` })).toEqual([
			expect.objectContaining({
				objectKey: `events/temp/abc123.webp`,
				contentType: `image/webp`,
				kind: `event`,
			}),
		]);
	});

	it(`round-trips a signed offering jpeg claim`, () => {
		const token = signGalleryImageClaim({
			objectKey: `offerings/temp/cover.jpg`,
			contentType: `image/jpeg`,
			kind: `offering`,
		});

		expect(verifyGalleryImageClaims({ claimTokens: [token], kind: `offering` })).toEqual([
			expect.objectContaining({
				objectKey: `offerings/temp/cover.jpg`,
				contentType: `image/jpeg`,
				kind: `offering`,
			}),
		]);
	});

	it(`deduplicates tokens before verifying`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});

		const claims = verifyGalleryImageClaims({ claimTokens: [token, token], kind: `event` });
		expect(claims).toHaveLength(1);
	});

	it(`rejects a tampered signature`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});
		const [payload] = token.split(`.`);

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [`${payload}.not-a-signature`], kind: `event` }));
	});

	it(`rejects a token with extra segments`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [`${token}.extra`], kind: `event` }));
	});

	it(`rejects an expired claim`, () => {
		const token = signedClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
			expiresAt: Date.now() - 1000,
		});

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [token], kind: `event` }), `Bild-Upload ist abgelaufen`);
	});

	it(`rejects a claim signed for a different kind`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [token], kind: `offering` }));
	});

	it(`rejects a claim whose object key is not in the temp prefix`, () => {
		const token = signGalleryImageClaim({
			objectKey: `events/demo-event/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [token], kind: `event` }));
	});

	it(`rejects an unsupported content type`, () => {
		const token = signedClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/png`,
			kind: `event`,
			expiresAt: Date.now() + 60_000,
		});

		expectInvalid(verifyGalleryImageClaims({ claimTokens: [token], kind: `event` }));
	});
});

describe(`createGalleryImageUpload`, () => {
	it(`returns a presigned upload and a claim the server will accept`, async () => {
		const result = await createGalleryImageUpload({ kind: `event`, contentType: `image/webp` });

		expect(result.uploadUrl).toBe(`https://upload.example/put`);
		expect(result.objectKey).toMatch(/^events\/temp\/[a-z0-9-]+\.webp$/);
		expect(verifyGalleryImageClaims({ claimTokens: [result.claimToken], kind: `event` })).toEqual([
			expect.objectContaining({
				objectKey: result.objectKey,
				contentType: `image/webp`,
				kind: `event`,
			}),
		]);
	});
});

describe(`finalizeGalleryImageClaims`, () => {
	beforeEach(() => {
		getObjectPrefix.mockClear();
		finalizeGalleryTempImage.mockClear();
	});

	it(`returns an empty list when there are no claims`, async () => {
		expect(await finalizeGalleryImageClaims({ kind: `event`, claims: [], ownerId: `my-slug` })).toEqual([]);
		expect(getObjectPrefix).not.toHaveBeenCalled();
	});

	it(`copies a verified temp object into the final owner key`, async () => {
		const token = signGalleryImageClaim({
			objectKey: `events/temp/cover.webp`,
			contentType: `image/webp`,
			kind: `event`,
		});
		const claims = verifyGalleryImageClaims({ claimTokens: [token], kind: `event` });
		if (claims instanceof Error) throw claims;

		await expect(
			finalizeGalleryImageClaims({
				kind: `event`,
				claims,
				ownerId: `my-slug`,
			}),
		).resolves.toEqual([`https://assets.blissbase.app/events/my-slug/cover.webp`]);
		expect(getObjectPrefix).toHaveBeenCalledWith({
			objectKey: `events/temp/cover.webp`,
			byteLength: 12,
			creds: eventAssetsCreds,
		});
	});
});

describe(`discardGalleryImageUpload`, () => {
	beforeEach(() => {
		deleteObjects.mockClear();
	});

	it(`does nothing for an invalid token`, async () => {
		await discardGalleryImageUpload(`not-a-claim`);
		expect(deleteObjects).not.toHaveBeenCalled();
	});

	it(`deletes an expired temp object when discarding`, async () => {
		const token = signedClaim({
			objectKey: `events/temp/abc123.webp`,
			contentType: `image/webp`,
			kind: `event`,
			expiresAt: Date.now() - 1000,
		});

		await discardGalleryImageUpload(token);
		expect(deleteObjects).toHaveBeenCalledWith([`events/temp/abc123.webp`], eventAssetsCreds);
	});
});

function signedClaim(claim: { objectKey: string; contentType: string; kind: string; expiresAt: number }) {
	const payload = Buffer.from(JSON.stringify(claim)).toString(`base64url`);
	const signature = createHmac(`sha256`, eventAssetsCreds.secretKey).update(payload).digest(`base64url`);
	return `${payload}.${signature}`;
}

function expectInvalid(result: unknown, message = `Bild-Upload ist ungültig`) {
	expect(result).toBeInstanceOf(Error);
	expect((result as Error).message).toBe(message);
}
