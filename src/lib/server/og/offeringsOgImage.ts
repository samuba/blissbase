import opentype from "opentype.js";
import { env } from "$env/dynamic/private";
import backgroundDataUrl from "./og-poster-bg.jpg?inline";
import goldLogoDataUrl from "../../../static/logo-gold.png?inline";
import brandFontDataUrl from "$lib/fonts/Baloo2-Medium.ttf?inline";
import { composeOgPoster } from "./ogPoster";
import { compressPngWithTinyPng } from "./tinyPng";

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
	return compressPngWithTinyPng({ png, apiKey: env.TINIFY_API_KEY });
}

function dataUrlToBuffer(dataUrl: string) {
	const comma = dataUrl.indexOf(`,`);
	return Buffer.from(dataUrl.slice(comma + 1), `base64`);
}

function dataUrlToArrayBuffer(dataUrl: string) {
	const { buffer, byteOffset, byteLength } = dataUrlToBuffer(dataUrl);
	return buffer.slice(byteOffset, byteOffset + byteLength);
}
