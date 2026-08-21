import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createOfferingsOgImage } from "./offeringsOgImage";

describe(`createOfferingsOgImage`, () => {
	it(`falls back to the plaster poster style as JPEG when no covers`, async () => {
		const jpeg = await createOfferingsOgImage({ imageUrls: [], locationLabel: `Berlin` });
		const metadata = await sharp(jpeg).metadata();

		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
		expect(metadata.format).toBe(`jpeg`);
	});

	it(`builds a collage JPEG from cover tiles in the poster style`, async () => {
		const tile = await sharp({
			create: {
				width: 200,
				height: 200,
				channels: 3,
				background: { r: 200, g: 120, b: 60 },
			},
		})
			.png()
			.toBuffer();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(tile, {
				status: 200,
				headers: { "Content-Type": `image/png` },
			})) as typeof fetch;

		try {
			const jpeg = await createOfferingsOgImage({
				imageUrls: [`https://example.com/a.png`, `https://example.com/b.png`, `https://example.com/c.png`],
				locationLabel: `Berlin`,
			});
			const metadata = await sharp(jpeg).metadata();

			expect(metadata.width).toBe(1200);
			expect(metadata.height).toBe(630);
			expect(metadata.format).toBe(`jpeg`);
			expect(jpeg.length).toBeGreaterThan(10_000);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it(`ignores failed cover fetches and still returns a JPEG`, async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error(`network down`);
		}) as typeof fetch;

		try {
			const jpeg = await createOfferingsOgImage({
				imageUrls: [`https://example.com/missing.png`],
				locationLabel: null,
			});
			const metadata = await sharp(jpeg).metadata();
			expect(metadata.format).toBe(`jpeg`);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
