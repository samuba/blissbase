import imageCompression from 'browser-image-compression';
import {
	IMAGE_UPLOAD_MAX_DIMENSION,
	IMAGE_UPLOAD_MAX_SIZE_MB,
	IMAGE_UPLOAD_OUTPUT_MIME_TYPE,
	IMAGE_UPLOAD_OUTPUT_QUALITY,
	getPerceptualHash,
	getProcessedImageFileName,
} from '$lib/imageUpload.shared';

const WEBP_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46];
const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff];
const JPEG_FALLBACK_MIME = `image/jpeg`;

let cachedCanvasWebPEncodeSupport: boolean | undefined;
let wasmWebPEncodePromise: Promise<typeof import('@jsquash/webp/encode')> | undefined;

/**
 * Returns whether this browser can encode WebP via canvas (Safari cannot).
 * @example
 * const canWebP = await canEncodeWebPViaCanvas();
 */
export async function canEncodeWebPViaCanvas() {
	if (cachedCanvasWebPEncodeSupport !== undefined) return cachedCanvasWebPEncodeSupport;
	if (typeof document === `undefined`) {
		cachedCanvasWebPEncodeSupport = false;
		return false;
	}

	const canvas = document.createElement(`canvas`);
	canvas.width = 1;
	canvas.height = 1;
	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, IMAGE_UPLOAD_OUTPUT_MIME_TYPE, 0.8);
	});
	cachedCanvasWebPEncodeSupport = Boolean(blob?.type === IMAGE_UPLOAD_OUTPUT_MIME_TYPE);
	return cachedCanvasWebPEncodeSupport;
}

/**
 * Converts one selected image into the normalized upload file (WebP).
 * Uses native canvas WebP when available; otherwise lazily loads @jsquash/webp.
 * @example
 * const file = await processImageUploadFile({ file, onProgress });
 */
export async function processImageUploadFile(args: {
	file: File;
	onProgress?: (progress: number) => void;
}) {
	args.onProgress?.(10);

	if (await canEncodeWebPViaCanvas()) {
		return processWithNativeWebP(args);
	}

	return processWithWasmWebP(args);
}

/**
 * Encodes already-rasterized image data to a WebP upload file.
 * Same native-vs-WASM strategy as {@link processImageUploadFile}.
 * @example
 * const file = await processImageDataToWebPFile({ imageData, originalFileName: `crop.webp` });
 */
export async function processImageDataToWebPFile(args: {
	imageData: ImageData;
	originalFileName: string;
	lastModified?: number;
	maxSizeMB?: number;
	quality?: number;
	onProgress?: (progress: number) => void;
}) {
	const lastModified = args.lastModified ?? Date.now();
	const maxSizeBytes = (args.maxSizeMB ?? IMAGE_UPLOAD_MAX_SIZE_MB) * 1024 * 1024;
	const quality = args.quality ?? IMAGE_UPLOAD_OUTPUT_QUALITY;
	args.onProgress?.(20);

	try {
		if (await canEncodeWebPViaCanvas()) {
			return await encodeImageDataWithNativeWebP({
				imageData: args.imageData,
				originalFileName: args.originalFileName,
				lastModified,
				maxSizeBytes,
				quality,
				onProgress: args.onProgress,
			});
		}

		return await encodeWebPWithWasm({
			imageData: args.imageData,
			originalFileName: args.originalFileName,
			lastModified,
			maxSizeBytes,
			quality,
			onProgress: args.onProgress,
		});
	} catch (error) {
		console.error(`WebP encoding from ImageData failed, falling back to JPEG:`, error);
		return encodeImageDataAsJpegFile({
			imageData: args.imageData,
			originalFileName: args.originalFileName,
			lastModified,
			quality,
		});
	}
}

async function processWithNativeWebP(args: {
	file: File;
	onProgress?: (progress: number) => void;
}) {
	const compressedFile = await imageCompression(args.file, {
		maxSizeMB: IMAGE_UPLOAD_MAX_SIZE_MB,
		maxWidthOrHeight: IMAGE_UPLOAD_MAX_DIMENSION,
		useWebWorker: true,
		fileType: IMAGE_UPLOAD_OUTPUT_MIME_TYPE,
		initialQuality: IMAGE_UPLOAD_OUTPUT_QUALITY,
		alwaysKeepResolution: true,
		onProgress: (progress: number) => {
			args.onProgress?.(Math.min(70, Math.max(10, progress * 0.7)));
		},
	});
	args.onProgress?.(72);

	const outputFile = await ensureCompressedFormat({ file: compressedFile });
	args.onProgress?.(80);

	const imageData = await createImageDataFromFile({ file: outputFile });
	args.onProgress?.(92);

	return toProcessedImageUploadFile({
		outputFile,
		imageData,
		originalFileName: args.file.name,
		lastModified: args.file.lastModified,
	});
}

/**
 * Resize/orient with a JPEG intermediate, then encode WebP via lazily loaded WASM.
 * Safari cannot encode WebP through canvas; @jsquash/webp is only fetched on this path.
 */
async function processWithWasmWebP(args: {
	file: File;
	onProgress?: (progress: number) => void;
}) {
	const resizedFile = await imageCompression(args.file, {
		// Intermediate only — final size is enforced by the WebP encoder.
		maxSizeMB: 5,
		maxWidthOrHeight: IMAGE_UPLOAD_MAX_DIMENSION,
		useWebWorker: true,
		fileType: JPEG_FALLBACK_MIME,
		initialQuality: 0.92,
		alwaysKeepResolution: true,
		onProgress: (progress: number) => {
			args.onProgress?.(Math.min(50, Math.max(10, progress * 0.5)));
		},
	});
	args.onProgress?.(55);

	const imageData = await createImageDataFromFile({ file: resizedFile });
	args.onProgress?.(62);

	try {
		const webpFile = await encodeWebPWithWasm({
			imageData,
			originalFileName: args.file.name,
			lastModified: args.file.lastModified,
			maxSizeBytes: IMAGE_UPLOAD_MAX_SIZE_MB * 1024 * 1024,
			quality: IMAGE_UPLOAD_OUTPUT_QUALITY,
			onProgress: args.onProgress,
		});
		args.onProgress?.(100);
		return webpFile;
	} catch (error) {
		console.error(`WASM WebP encoding failed, falling back to JPEG:`, error);
		const jpegFile = await ensureCompressedFormat({ file: resizedFile });
		return toProcessedImageUploadFile({
			outputFile: jpegFile,
			imageData,
			originalFileName: args.file.name,
			lastModified: args.file.lastModified,
		});
	}
}

async function encodeImageDataAsJpegFile(args: {
	imageData: ImageData;
	originalFileName: string;
	lastModified: number;
	quality: number;
}) {
	const canvas = document.createElement(`canvas`);
	canvas.width = args.imageData.width;
	canvas.height = args.imageData.height;
	const ctx = canvas.getContext(`2d`);
	if (!ctx) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);
	ctx.putImageData(args.imageData, 0, 0);

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, JPEG_FALLBACK_MIME, args.quality)
	);
	if (!blob) throw new Error(`JPEG-Fallback-Kodierung fehlgeschlagen`);

	return toProcessedImageUploadFile({
		outputFile: new File([blob], `crop.jpg`, {
			type: JPEG_FALLBACK_MIME,
			lastModified: args.lastModified,
		}),
		imageData: args.imageData,
		originalFileName: args.originalFileName,
		lastModified: args.lastModified,
	});
}

async function encodeImageDataWithNativeWebP(args: {
	imageData: ImageData;
	originalFileName: string;
	lastModified: number;
	maxSizeBytes: number;
	quality: number;
	onProgress?: (progress: number) => void;
}) {
	const canvas = document.createElement(`canvas`);
	canvas.width = args.imageData.width;
	canvas.height = args.imageData.height;
	const ctx = canvas.getContext(`2d`);
	if (!ctx) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);
	ctx.putImageData(args.imageData, 0, 0);

	let quality = args.quality;
	let webpBlob: Blob | undefined;

	for (let attempt = 0; attempt < 8; attempt++) {
		args.onProgress?.(40 + attempt * 7);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, IMAGE_UPLOAD_OUTPUT_MIME_TYPE, quality)
		);
		if (blob?.type === IMAGE_UPLOAD_OUTPUT_MIME_TYPE) {
			webpBlob = blob;
			if (blob.size <= args.maxSizeBytes || quality <= 0.4) break;
		}
		quality = Math.max(0.4, quality * 0.85);
	}

	if (!webpBlob) throw new Error(`WebP-Kodierung fehlgeschlagen`);

	return toProcessedImageUploadFile({
		outputFile: new File([webpBlob], `crop.webp`, {
			type: IMAGE_UPLOAD_OUTPUT_MIME_TYPE,
			lastModified: args.lastModified,
		}),
		imageData: args.imageData,
		originalFileName: args.originalFileName,
		lastModified: args.lastModified,
	});
}

async function encodeWebPWithWasm(args: {
	imageData: ImageData;
	originalFileName: string;
	lastModified: number;
	maxSizeBytes: number;
	quality: number;
	onProgress?: (progress: number) => void;
}) {
	const { default: encode } = await loadWasmWebPEncode();
	let quality = Math.round(args.quality * 100);
	let webpBytes: Uint8Array | undefined;

	for (let attempt = 0; attempt < 8; attempt++) {
		args.onProgress?.(65 + attempt * 4);
		const encoded = await encode(args.imageData, {
			quality,
			method: 4,
		});
		webpBytes = trimWebPBytes(encoded);
		if (webpBytes.byteLength <= args.maxSizeBytes || quality <= 40) break;
		quality = Math.max(40, Math.round(quality * 0.85));
	}

	if (!webpBytes?.length) throw new Error(`WebP-WASM-Kodierung fehlgeschlagen`);

	const hash = getPerceptualHash({ imageData: args.imageData });
	const fileName = getProcessedImageFileName({
		hash,
		originalFileName: args.originalFileName,
	});
	const webpBuffer = webpBytes.buffer.slice(
		webpBytes.byteOffset,
		webpBytes.byteOffset + webpBytes.byteLength
	) as ArrayBuffer;
	return new File([webpBuffer], fileName, {
		type: IMAGE_UPLOAD_OUTPUT_MIME_TYPE,
		lastModified: args.lastModified,
	});
}

function loadWasmWebPEncode() {
	if (!wasmWebPEncodePromise) {
		wasmWebPEncodePromise = import(`@jsquash/webp/encode`);
	}
	return wasmWebPEncodePromise;
}

/**
 * jSquash may return a view into the full WASM heap via `.buffer`.
 * Trim to the RIFF-declared WebP length.
 */
function trimWebPBytes(buffer: ArrayBuffer) {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	if (bytes.byteLength < 12) throw new Error(`WebP-Ausgabe ist ungültig`);
	if (!WEBP_MAGIC_BYTES.every((b, i) => bytes[i] === b)) {
		throw new Error(`WebP-Ausgabe hat keinen RIFF-Header`);
	}

	const riffSize = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);
	const totalSize = riffSize + 8;
	if (totalSize < 12 || totalSize > bytes.byteLength) {
		throw new Error(`WebP-Ausgabe hat eine ungültige Größe`);
	}
	return bytes.slice(0, totalSize);
}

function toProcessedImageUploadFile(args: {
	outputFile: File;
	imageData: ImageData;
	originalFileName: string;
	lastModified: number;
}) {
	const hash = getPerceptualHash({ imageData: args.imageData });
	const extension = args.outputFile.type === JPEG_FALLBACK_MIME ? `jpg` : undefined;
	const fileName = getProcessedImageFileName({
		hash,
		originalFileName: args.originalFileName,
		extension,
	});
	return new File([args.outputFile], fileName, {
		type: args.outputFile.type,
		lastModified: args.lastModified,
	});
}

/**
 * Verifies WebP output and re-encodes as JPEG if the browser fell back (e.g. PNG on Safari).
 */
async function ensureCompressedFormat(args: { file: File }) {
	if (await isWebP({ file: args.file })) {
		return new File([args.file], args.file.name.replace(/\.\w+$/, `.webp`), {
			type: IMAGE_UPLOAD_OUTPUT_MIME_TYPE,
			lastModified: args.file.lastModified,
		});
	}
	if (await isJpeg({ file: args.file })) {
		return new File([args.file], args.file.name.replace(/\.\w+$/, `.jpg`), {
			type: JPEG_FALLBACK_MIME,
			lastModified: args.file.lastModified,
		});
	}

	const image = await loadImageFromFile({ file: args.file });
	try {
		const size = getContainedImageSize({
			width: image.naturalWidth,
			height: image.naturalHeight,
		});
		const canvas = document.createElement(`canvas`);
		canvas.width = size.width;
		canvas.height = size.height;

		const ctx = canvas.getContext(`2d`);
		if (!ctx) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);
		ctx.drawImage(image, 0, 0, size.width, size.height);

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, JPEG_FALLBACK_MIME, IMAGE_UPLOAD_OUTPUT_QUALITY)
		);
		if (!blob) throw new Error(`JPEG-Fallback-Kodierung fehlgeschlagen`);

		return new File([blob], args.file.name.replace(/\.\w+$/, `.jpg`), {
			type: JPEG_FALLBACK_MIME,
			lastModified: args.file.lastModified,
		});
	} finally {
		image.remove();
	}
}

async function isWebP(args: { file: File }) {
	if (args.file.size < 12) return false;
	const header = new Uint8Array(await args.file.slice(0, 4).arrayBuffer());
	return WEBP_MAGIC_BYTES.every((b, i) => header[i] === b);
}

async function isJpeg(args: { file: File }) {
	if (args.file.size < 3) return false;
	const header = new Uint8Array(await args.file.slice(0, 3).arrayBuffer());
	return JPEG_MAGIC_BYTES.every((b, i) => header[i] === b);
}

function loadImageFromFile(args: { file: File }) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		const objectUrl = URL.createObjectURL(args.file);

		image.onload = () => {
			URL.revokeObjectURL(objectUrl);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error(`Bild konnte nicht geladen werden`));
		};
		image.src = objectUrl;
	});
}

function getContainedImageSize(args: { width: number; height: number }) {
	if (!args.width || !args.height) {
		throw new Error(`Bildabmessungen sind ungültig`);
	}

	const scale = Math.min(1, IMAGE_UPLOAD_MAX_DIMENSION / args.width, IMAGE_UPLOAD_MAX_DIMENSION / args.height);
	return {
		width: Math.max(1, Math.round(args.width * scale)),
		height: Math.max(1, Math.round(args.height * scale)),
	};
}

async function createImageDataFromFile(args: { file: File }) {
	const image = await loadImageFromFile({ file: args.file });

	try {
		const size = getContainedImageSize({
			width: image.naturalWidth,
			height: image.naturalHeight,
		});
		const canvas = document.createElement(`canvas`);
		canvas.width = size.width;
		canvas.height = size.height;

		const context = canvas.getContext(`2d`);
		if (!context) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);

		context.drawImage(image, 0, 0, size.width, size.height);
		return context.getImageData(0, 0, size.width, size.height);
	} finally {
		image.remove();
	}
}
