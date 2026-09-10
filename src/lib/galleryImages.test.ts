import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
	assertGalleryImageObject,
	GALLERY_IMAGE_MAX_COUNT,
	GALLERY_IMAGE_MAX_BYTES,
	galleryImageClaimsSchema,
	getNextGalleryImageUrls,
	getOrderedGalleryPreviewEntries,
	publicUrlFromImageClaim,
	uniqueGalleryImageClaimTokens,
} from "$lib/galleryImages";

const a = `https://assets.blissbase.app/a.webp`;
const b = `https://assets.blissbase.app/b.webp`;
const c = `https://assets.blissbase.app/c.webp`;

describe(`publicUrlFromImageClaim`, () => {
	it(`builds the CDN URL from the claim payload`, () => {
		const payload = Buffer.from(JSON.stringify({ objectKey: `events/temp/cover.webp` })).toString(`base64url`);
		expect(publicUrlFromImageClaim(`${payload}.sig`)).toBe(`https://assets.blissbase.app/events/temp/cover.webp`);
	});

	it(`returns empty for malformed tokens`, () => {
		expect(publicUrlFromImageClaim(``)).toBe(``);
		expect(publicUrlFromImageClaim(`not-json.sig`)).toBe(``);
	});
});

describe(`assertGalleryImageObject`, () => {
	it(`accepts a WebP header within the size limit`, () => {
		expect(() =>
			assertGalleryImageObject({
				headerBytes: webpHeader(),
				size: 12,
				contentType: `image/webp`,
			}),
		).not.toThrow();
	});

	it(`rejects a RIFF file that is not WebP`, () => {
		expect(() =>
			assertGalleryImageObject({
				headerBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
				size: 12,
				contentType: `image/webp`,
			}),
		).toThrow(`Bild-Upload ist ungültig`);
	});

	it(`rejects a JPEG header when WebP is required`, () => {
		expect(() =>
			assertGalleryImageObject({
				headerBytes: new Uint8Array([0xff, 0xd8, 0xff]),
				size: 3,
				contentType: `image/webp`,
			}),
		).toThrow(`Bild-Upload ist ungültig`);
	});

	it(`rejects an oversized object without needing its full bytes`, () => {
		expect(() =>
			assertGalleryImageObject({
				headerBytes: webpHeader(),
				size: GALLERY_IMAGE_MAX_BYTES + 1,
				contentType: `image/webp`,
			}),
		).toThrow(`Bild-Upload ist zu groß`);
	});
});

describe(`galleryImageClaimsSchema`, () => {
	it(`deduplicates tokens before enforcing the max count`, () => {
		const tokens = Array.from({ length: 7 }, (_, i) => `claim-${i}`);
		const result = v.safeParse(galleryImageClaimsSchema, [...tokens, ...tokens]);
		expect(result.success).toBe(true);
		if (result.success) expect(result.output).toEqual(tokens);
	});

	it(`rejects more than the max unique tokens`, () => {
		const result = v.safeParse(
			galleryImageClaimsSchema,
			Array.from({ length: GALLERY_IMAGE_MAX_COUNT + 1 }, (_, i) => `claim-${i}`),
		);
		expect(result.success).toBe(false);
	});
});

describe(`getNextGalleryImageUrls`, () => {
	it(`keeps existing URLs and maps claims in the submitted order`, () => {
		expect(
			getNextGalleryImageUrls({
				currentImageUrls: [a, b],
				submittedImageUrls: [b],
				submittedClaimTokens: [`claim-1`],
				uploadedImageUrls: [c],
				imageOrder: [`claim-1`, b],
			}),
		).toEqual([c, b]);
	});

	it(`deletes every current image when none are resubmitted`, () => {
		expect(
			getNextGalleryImageUrls({
				currentImageUrls: [a, b],
				submittedImageUrls: [],
				submittedClaimTokens: [],
				uploadedImageUrls: [],
				imageOrder: [],
			}),
		).toEqual([]);
	});

	it(`appends existing then claims when imageOrder is empty`, () => {
		expect(
			getNextGalleryImageUrls({
				currentImageUrls: [a, b],
				submittedImageUrls: [a, b],
				submittedClaimTokens: [`claim-1`],
				uploadedImageUrls: [c],
				imageOrder: [],
			}),
		).toEqual([a, b, c]);
	});

	it(`deduplicates submitted URLs and claim tokens`, () => {
		expect(
			getNextGalleryImageUrls({
				currentImageUrls: [a, b],
				submittedImageUrls: [a, a, b],
				submittedClaimTokens: [`claim-1`, `claim-1`],
				uploadedImageUrls: [c, c],
				imageOrder: [a, a, `claim-1`, `claim-1`],
			}),
		).toEqual([a, c, b]);
	});

	it(`does not restore a current image that was omitted from the submission`, () => {
		expect(
			getNextGalleryImageUrls({
				currentImageUrls: [a, b, c],
				submittedImageUrls: [a, c],
				submittedClaimTokens: [],
				uploadedImageUrls: [],
				imageOrder: [b, a, c],
			}),
		).toEqual([a, c]);
	});
});

describe(`getOrderedGalleryPreviewEntries`, () => {
	it(`interleaves existing URLs and claims from imageOrder`, () => {
		expect(
			getOrderedGalleryPreviewEntries({
				existingUrls: [a, b],
				claimTokens: [`claim-1`],
				imageOrder: [`claim-1`, b],
			}),
		).toEqual([
			{ source: `new`, claimToken: `claim-1` },
			{ source: `existing`, url: b },
			{ source: `existing`, url: a },
		]);
	});
});

describe(`uniqueGalleryImageClaimTokens`, () => {
	it(`deduplicates and caps the list`, () => {
		expect(uniqueGalleryImageClaimTokens([`a`, `a`, `b`])).toEqual([`a`, `b`]);
		expect(uniqueGalleryImageClaimTokens(Array.from({ length: GALLERY_IMAGE_MAX_COUNT + 1 }, (_, i) => `t${i}`))).toHaveLength(
			GALLERY_IMAGE_MAX_COUNT,
		);
	});
});

function webpHeader() {
	return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
}
