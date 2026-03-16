import { bmvbhash } from 'blockhash-core';

export const EVENT_IMAGE_MAX_DIMENSION = 850;
export const EVENT_IMAGE_OUTPUT_MIME_TYPE = `image/webp`;
export const EVENT_IMAGE_OUTPUT_EXTENSION = `webp`;
export const EVENT_IMAGE_OUTPUT_QUALITY = 0.95;
export const EVENT_IMAGE_HASH_PREFIX_BYTES = 8;
export const EVENT_IMAGE_HASH_LENGTH = 11;
export const EVENT_IMAGE_PHASH_BITS = 8;

/**
 * Creates a stable short content hash from processed image bytes.
 *
 * @example
 * const hash = await getStableContentHash({ bytes: new Uint8Array([1, 2, 3]) });
 */
export async function getStableContentHash(args: { bytes: ArrayBuffer | Uint8Array }) {
	const bytes = args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
	const digestInput = Uint8Array.from(bytes);
	const digestBuffer = await crypto.subtle.digest(`SHA-256`, digestInput);
	const digestBytes = new Uint8Array(digestBuffer).slice(0, EVENT_IMAGE_HASH_PREFIX_BYTES);
	return toBase64Url(digestBytes);
}

/**
 * Creates a compact perceptual hash from image data.
 *
 * @example
 * const hash = getPerceptualHash({ imageData });
 */
export function getPerceptualHash(args: { imageData: HashImageData }) {
	const hexHash = bmvbhash(args.imageData, EVENT_IMAGE_PHASH_BITS);
	return hexToBase64Url(hexHash);
}

/**
 * Builds the processed client file name from the hash and original file name.
 *
 * @example
 * getProcessedImageFileName({ hash: `abc123def45`, originalFileName: `cover photo.png` });
 */
export function getProcessedImageFileName(args: { hash: string; originalFileName: string }) {
	const safeBaseName = sanitizeFileBaseName(stripFileExtension(args.originalFileName));
	if (!safeBaseName) return `${args.hash}.${EVENT_IMAGE_OUTPUT_EXTENSION}`;
	return `${args.hash}-${safeBaseName}.${EVENT_IMAGE_OUTPUT_EXTENSION}`;
}

/**
 * Extracts the processed image hash from the file name prefix.
 *
 * @example
 * getProcessedImageHashFromFileName({ fileName: `abc123def45-cover.webp` });
 */
export function getProcessedImageHashFromFileName(args: { fileName: string }) {
	const match = args.fileName.match(new RegExp(`^([A-Za-z0-9_-]{${EVENT_IMAGE_HASH_LENGTH}})(?:[.-]|$)`));
	return match?.[1];
}

/**
 * Removes the file extension from a file name.
 *
 * @example
 * stripFileExtension(`cover.png`);
 */
export function stripFileExtension(fileName: string) {
	return fileName.replace(/\.[^.]+$/, ``);
}

/**
 * Sanitizes a file base name for stable uploads and tests.
 *
 * @example
 * sanitizeFileBaseName(`My cover image!`);
 */
export function sanitizeFileBaseName(fileName: string) {
	return fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, `-`).replace(/^-+|-+$/g, ``);
}

/**
 * Encodes bytes into a URL-safe base64 string without padding.
 *
 * @example
 * toBase64Url(new Uint8Array([255, 0]));
 */
export function toBase64Url(bytes: Uint8Array) {
	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, `-`).replace(/\//g, `_`).replace(/=/g, ``);
}

/**
 * Converts a hex hash into a compact URL-safe base64 string.
 *
 * @example
 * hexToBase64Url(`0123456789abcdef`);
 */
export function hexToBase64Url(hex: string) {
	if (!hex.length || hex.length % 2 !== 0) {
		throw new Error(`Hex hash must contain an even number of characters`);
	}

	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
	}

	return toBase64Url(bytes);
}

type HashImageData = {
	width: number;
	height: number;
	data: Uint8Array | Uint8ClampedArray | number[];
};
