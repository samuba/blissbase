import opentype from "opentype.js";
import sharp from "sharp";
import backgroundDataUrl from "./og-poster-bg.jpg?inline";
import goldLogoDataUrl from "../../../../static/logo-gold.png?inline";
import brandFontDataUrl from "$lib/fonts/Baloo2-Medium.ttf?inline";
import { composeOgPoster } from "./ogPoster";

const brandFont = opentype.parse(dataUrlToArrayBuffer(brandFontDataUrl));
const background = dataUrlToBuffer(backgroundDataUrl);
const goldLogo = dataUrlToBuffer(goldLogoDataUrl);

/**
 * Builds a WhatsApp-friendly 1200×630 OG image in the Blissbase poster style.
 */
export async function createOfferingsOgImage({ locationLabel }: { locationLabel?: string | null }): Promise<Buffer> {
	const place = locationLabel?.trim();
	const png = await composeOgPoster({
		title: `Blissbase`,
		subtitle: place ? `Find conscious offerings in ${place}` : `Find conscious offerings near you`,
		background,
		goldLogo,
		brandFont,
	});
	return sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

function dataUrlToBuffer(dataUrl: string) {
	const comma = dataUrl.indexOf(`,`);
	return Buffer.from(dataUrl.slice(comma + 1), `base64`);
}

function dataUrlToArrayBuffer(dataUrl: string) {
	const { buffer, byteOffset, byteLength } = dataUrlToBuffer(dataUrl);
	return buffer.slice(byteOffset, byteOffset + byteLength);
}
