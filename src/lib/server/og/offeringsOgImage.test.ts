import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock(`$env/dynamic/private`, () => ({ env: {} }));

import { createOfferingsOgImage } from "./offeringsOgImage";

describe(`createOfferingsOgImage`, () => {
	it(`uses the shared poster style with a location subtitle`, async () => {
		const png = await createOfferingsOgImage({ locationLabel: `Berlin` });
		const metadata = await sharp(png).metadata();

		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
		expect(metadata.format).toBe(`png`);
	});
});
