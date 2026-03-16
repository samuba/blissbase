import type { Config } from '@sveltejs/adapter-vercel';
import { json } from '@sveltejs/kit';
import { ENDPOINT_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import * as assets from '$lib/assets';
import { eventAssetsCreds } from '$lib/events.remote.shared';
import { resizeCoverImage } from '$lib/imageProcessing';
import { E2E_TEST } from '$env/static/private';

// we have this in a separate, splitted endpoint cuz of image stuff bloating the vercel function to 66MB
export const config: Config = {
	split: true // 
};

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	if (getFormField(formData, `secret`) !== ENDPOINT_SECRET) {
		return json({ error: `Unauthorized` }, { status: 401 });
	}
	const slug = getFormField(formData, `slug`);
	if (!slug) return json({ error: `Missing event slug` }, { status: 400 });

	try {
		const files = getImageFiles(formData);
		if (!files.length) {
			return json({ imageUrls: [] });
		}

		const imageUrls = await uploadEventImages({ files, slug });
		return json({ imageUrls });
	} catch (err) {
		console.error(`Failed to upload event images:`, err);
		return json({ error: `Failed to upload event images` }, { status: 500 });
	}
};

/**
 * Reads and trims a field value from the multipart request payload.
 *
 * @example
 * getFormField({ formData: new FormData(), key: `secret` })
 */
function getFormField(formData: FormData, key: string) {
	const value = formData.get(key);
	if (typeof value !== `string`) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed;
}

/**
 * Extracts valid image files from the multipart request payload.
 *
 * @example
 * getImageFiles(new FormData());
 */
function getImageFiles(formData: FormData) {
	return formData.getAll(`images`).filter((entry): entry is File => entry instanceof File);
}

/**
 * Processes uploaded event images and uploads deduplicated results to storage.
 */
async function uploadEventImages(args: UploadEventImagesArgs) {
	if (!args.files?.length) return [];
	if (E2E_TEST === `true`) {
		return getE2EImageUrls(args);
	}

	console.time(`uploadEventImages`);

	const processedImages = new Map<string, Promise<string>>();
	const imageUrls: string[] = [];

	for (const file of args.files) {
		if (!file || file.size <= 0) continue;

		let cacheKey: string | undefined = undefined;

		try {
			const bytes = Buffer.from(await file.arrayBuffer());
			const { buffer, phash } = await resizeCoverImage(bytes);
			cacheKey = `${args.slug}:${phash}`;

			let imageUrlPromise = processedImages.get(cacheKey);
			if (!imageUrlPromise) {
				imageUrlPromise = assets.uploadImage(buffer, args.slug, phash, eventAssetsCreds);
				processedImages.set(cacheKey, imageUrlPromise);
			}

			imageUrls.push(await imageUrlPromise);
		} catch (err) {
			if (cacheKey) processedImages.delete(cacheKey);
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error processing event image "${file.name}". Skipping it:`, message);
		}
	}

	console.timeEnd(`uploadEventImages`);
	return imageUrls;
}

/**
 * Builds deterministic mock image URLs for E2E without touching external storage.
 *
 * @example
 * getE2EImageUrls({ files: [], slug: `demo-event` });
 */
function getE2EImageUrls(args: UploadEventImagesArgs) {
	if (!args.files?.length) return [];

	return args.files.map((file, index) => {
		const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, `-`);
		return `https://assets.blissbase.app/e2e/${args.slug}/${index}-${safeFileName}.webp`;
	});
}

type UploadEventImagesArgs = {
	files: File[];
	slug: string;
};
