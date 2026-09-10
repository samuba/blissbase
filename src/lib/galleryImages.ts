import { IMAGE_UPLOAD_MAX_SIZE_MB } from "$lib/imageUpload.shared";
import * as v from "valibot";

export const GALLERY_IMAGE_MAX_COUNT = 12;
export const GALLERY_IMAGE_CLAIM_TTL_MS = 2 * 60 * 60 * 1000;
export const GALLERY_IMAGE_MAX_BYTES = Math.ceil(IMAGE_UPLOAD_MAX_SIZE_MB * 1024 * 1024 * 1.25);
export const GALLERY_IMAGE_HEADER_BYTES = 12;
export const GALLERY_IMAGE_KINDS = [`event`, `offering`] as const;
export const GALLERY_IMAGE_CONTENT_TYPES = [`image/webp`, `image/jpeg`] as const;

const WEBP_RIFF_BYTES = [0x52, 0x49, 0x46, 0x46];
const WEBP_FOURCC_BYTES = [0x57, 0x45, 0x42, 0x50];
const WEBP_FOURCC_OFFSET = 8;
const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff];
const ASSETS_ORIGIN = `https://assets.blissbase.app`;

export const galleryImageClaimsSchema = v.optional(
	v.pipe(
		v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())),
		v.transform((tokens) => [...new Set(tokens)]),
		v.maxLength(GALLERY_IMAGE_MAX_COUNT, `You can upload a maximum of ${GALLERY_IMAGE_MAX_COUNT} images`),
	),
	[],
);

export const galleryImageOrderSchema = v.optional(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())), []);

export function publicUrlFromImageClaim(token: string) {
	const [payload] = token.split(`.`);
	if (!payload) return ``;
	try {
		const claim = JSON.parse(decodeBase64Url(payload)) as { objectKey?: unknown };
		if (typeof claim.objectKey !== `string` || !claim.objectKey.trim()) return ``;
		return `${ASSETS_ORIGIN}/${claim.objectKey}`;
	} catch {
		return ``;
	}
}

export function getImageSuffixFromObjectKey(objectKey: string) {
	const fileName = objectKey.split(`/`).at(-1);
	return fileName?.replace(/\.(webp|jpg)$/, ``);
}

export function assertGalleryImageObject(args: { headerBytes: Uint8Array; size: number; contentType: GalleryImageContentType }) {
	if (args.size <= 0) throw new Error(`Bild-Upload ist leer`);
	if (args.size > GALLERY_IMAGE_MAX_BYTES) throw new Error(`Bild-Upload ist zu groß`);
	if (args.contentType === `image/webp` && !isWebpBytes(args.headerBytes)) {
		throw new Error(`Bild-Upload ist ungültig`);
	}
	if (args.contentType === `image/jpeg` && !hasMagicBytes(args.headerBytes, JPEG_MAGIC_BYTES)) {
		throw new Error(`Bild-Upload ist ungültig`);
	}
}

export function uniqueGalleryImageClaimTokens(claimTokens: string[]) {
	return [...new Set(claimTokens ?? [])].slice(0, GALLERY_IMAGE_MAX_COUNT);
}

export function getOrderedGalleryPreviewEntries(args: {
	existingUrls: string[];
	claimTokens: string[];
	imageOrder?: string[];
}) {
	const existingUrls = [...new Set((args.existingUrls ?? []).filter(Boolean))];
	const claimTokens = uniqueGalleryImageClaimTokens(args.claimTokens ?? []);
	const existingSet = new Set(existingUrls);
	const claimSet = new Set(claimTokens);
	const entries: GalleryPreviewEntry[] = [];
	const usedExisting = new Set<string>();
	const usedClaims = new Set<string>();

	const addExisting = (url: string) => {
		if (!existingSet.has(url) || usedExisting.has(url)) return;
		usedExisting.add(url);
		entries.push({ source: `existing`, url });
	};
	const addClaim = (token: string) => {
		if (!claimSet.has(token) || usedClaims.has(token)) return;
		usedClaims.add(token);
		entries.push({ source: `new`, claimToken: token });
	};

	for (const token of args.imageOrder ?? []) {
		if (existingSet.has(token)) addExisting(token);
		else addClaim(token);
	}
	for (const url of existingUrls) addExisting(url);
	for (const token of claimTokens) addClaim(token);

	return entries.slice(0, GALLERY_IMAGE_MAX_COUNT);
}

export function getNextGalleryImageUrls(args: {
	currentImageUrls: string[];
	submittedImageUrls: string[];
	submittedClaimTokens: string[];
	uploadedImageUrls: string[];
	imageOrder: string[];
}) {
	const existingImageUrls = keepSubmittedImages({
		currentImageUrls: args.currentImageUrls,
		submittedImageUrls: args.submittedImageUrls,
	});
	const existingUrls = new Set(existingImageUrls);
	const uploadedUrlByClaimToken = new Map(
		args.submittedClaimTokens.flatMap((token, index) => {
			const url = args.uploadedImageUrls[index];
			if (!url) return [];
			return [[token, url] as const];
		}),
	);
	const nextImageUrls: string[] = [];

	for (const token of args.imageOrder) {
		if (existingUrls.has(token)) {
			addUniqueImageUrl({ imageUrls: nextImageUrls, url: token });
			continue;
		}
		const uploadedUrl = uploadedUrlByClaimToken.get(token);
		if (uploadedUrl) addUniqueImageUrl({ imageUrls: nextImageUrls, url: uploadedUrl });
	}

	for (const url of existingImageUrls) {
		addUniqueImageUrl({ imageUrls: nextImageUrls, url });
	}
	for (const token of args.submittedClaimTokens) {
		const uploadedUrl = uploadedUrlByClaimToken.get(token);
		if (uploadedUrl) addUniqueImageUrl({ imageUrls: nextImageUrls, url: uploadedUrl });
	}

	return nextImageUrls.slice(0, GALLERY_IMAGE_MAX_COUNT);
}

function keepSubmittedImages(args: { currentImageUrls: string[]; submittedImageUrls: string[] }) {
	if (!args.currentImageUrls?.length || !args.submittedImageUrls?.length) return [];

	const currentUrls = new Set(args.currentImageUrls);
	const keptUrls = new Set<string>();
	return args.submittedImageUrls.filter((url) => {
		if (!currentUrls.has(url)) return false;
		if (keptUrls.has(url)) return false;
		keptUrls.add(url);
		return true;
	});
}

function addUniqueImageUrl(args: { imageUrls: string[]; url: string }) {
	if (args.imageUrls.includes(args.url)) return;
	args.imageUrls.push(args.url);
}

function isWebpBytes(bytes: Uint8Array) {
	return hasMagicBytes(bytes, WEBP_RIFF_BYTES) && hasMagicBytes(bytes, WEBP_FOURCC_BYTES, WEBP_FOURCC_OFFSET);
}

function hasMagicBytes(bytes: Uint8Array, magic: number[], offset = 0) {
	if (bytes.length < offset + magic.length) return false;
	return magic.every((value, index) => bytes[offset + index] === value);
}

function decodeBase64Url(value: string) {
	if (typeof Buffer !== `undefined`) {
		return Buffer.from(value, `base64url`).toString(`utf8`);
	}
	const padded = value.replace(/-/g, `+`).replace(/_/g, `/`);
	const padLength = (4 - (padded.length % 4)) % 4;
	return atob(`${padded}${"=".repeat(padLength)}`);
}

export type GalleryImageKind = (typeof GALLERY_IMAGE_KINDS)[number];
export type GalleryImageContentType = (typeof GALLERY_IMAGE_CONTENT_TYPES)[number];
export type GalleryPreviewEntry = { source: `existing`; url: string } | { source: `new`; claimToken: string };
