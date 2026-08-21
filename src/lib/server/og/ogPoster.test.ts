import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeOgPoster } from "./ogPoster";

const fontFile = readFileSync(new URL(`../../fonts/Baloo2-Medium.ttf`, import.meta.url));
const brandFont = opentype.parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));
const background = readFileSync(new URL(`./og-poster-bg.jpg`, import.meta.url));
const goldLogo = readFileSync(new URL(`../../../../static/logo-gold.png`, import.meta.url));

describe(`composeOgPoster`, () => {
	it(`renders a 1200×630 PNG in the shared poster style`, async () => {
		const png = await composeOgPoster({
			title: `Blissbase`,
			subtitle: `Find conscious offerings near you`,
			background,
			goldLogo,
			brandFont,
		});
		const metadata = await sharp(png).metadata();

		expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
		expect(metadata.format).toBe(`png`);
	});
});
