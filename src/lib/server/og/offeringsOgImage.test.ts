import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createOfferingsOgImage } from "./offeringsOgImage";

describe(`createOfferingsOgImage`, () => {
	it(`uses the shared poster style with a location subtitle`, async () => {
		const jpeg = await createOfferingsOgImage({ locationLabel: `Berlin` });
		const metadata = await sharp(jpeg).metadata();

		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
		expect(metadata.format).toBe(`jpeg`);
	});
});
