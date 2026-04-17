import { S3Client } from '@bradenmacdonald/s3-lite-client';

export type S3Creds = ReturnType<typeof loadCreds>;

// Instead of reading process.env directly
export function loadCreds(env?: {
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_BUCKET_NAME: string;
    CLOUDFLARE_ACCOUNT_ID: string;
}) {
    return {
        accessKey: env?.S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID!,
        secretKey: env?.S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY!,
        bucket: env?.S3_BUCKET_NAME ?? process.env.S3_BUCKET_NAME!,
        endPoint: `https://${env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
        region: "auto",
    };
}

export interface Image {
	public_id: string;
	secure_url: string;
	created_at: string;
	bytes: number;
	format: string;
}

export function eventImageObjectKey(eventSlug: string, phash: string, contentType = `image/webp`) {
	return `events/${eventSlug}/${phash}.${getImageObjectExtensionFromMimeType(contentType)}`;
}

/**
 * Builds the R2 key for one public profile image. When `suffix` is supplied, a unique-per-upload
 * key is produced so CDN caches never serve a stale crop after the user uploads a new one.
 *
 * @example
 * publicProfileImageObjectKey(`user-123`, `profile`)
 * publicProfileImageObjectKey(`user-123`, `banner`, `image/webp`, `ab12cd34`)
 */
export function publicProfileImageObjectKey(
	profileId: string,
	type: 'profile' | 'banner',
	contentType = `image/webp`,
	suffix?: string
) {
	const ext = getImageObjectExtensionFromMimeType(contentType);
	if (suffix?.trim()) return `profiles/${profileId}/${type}-${suffix}.${ext}`;
	return `profiles/${profileId}/${type}.${ext}`;
}

const PUBLIC_URL_ORIGIN = `https://assets.blissbase.app`;

/**
 * Builds the public URL for an R2 object stored under `assets.blissbase.app`.
 */
export function publicUrl(objectKey: string) {
	return `${PUBLIC_URL_ORIGIN}/${objectKey}`;
}

/**
 * Converts a public asset URL back into its bucket object key, or returns `null` for non-matching inputs.
 *
 * @example
 * objectKeyFromPublicUrl(`https://assets.blissbase.app/profiles/u1/profile-abc.webp`);
 */
export function objectKeyFromPublicUrl(url: string | null | undefined) {
	if (!url) return null;
	if (!url.startsWith(`${PUBLIC_URL_ORIGIN}/`)) return null;
	return url.slice(PUBLIC_URL_ORIGIN.length + 1) || null;
}

/**
 * Lists every object key in the bucket matching the given prefix.
 *
 * @example
 * const keys = await listObjectKeysByPrefix({ prefix: `profiles/u1/profile-`, creds });
 */
export async function listObjectKeysByPrefix(args: { prefix: string; creds: S3Creds }) {
	if (!args.prefix?.trim()) throw new Error(`Prefix cannot be empty`);
	const s3 = new S3Client(args.creds);
	const keys: string[] = [];
	for await (const obj of s3.listObjects({ prefix: args.prefix })) {
		if (obj.key) keys.push(obj.key);
	}
	return keys;
}

/**
 * Creates a presigned PUT URL that lets the browser upload a single object directly to R2.
 * The presigned URL expires after `expirySeconds` (default 5 minutes).
 *
 * @example
 * const url = await getPresignedPutUrl({ objectKey: `profiles/u1/profile-ab12.webp`, creds });
 */
export async function getPresignedPutUrl(args: {
	objectKey: string;
	creds: S3Creds;
	expirySeconds?: number;
}) {
	if (!args.objectKey?.trim()) throw new Error(`Object key cannot be empty`);
	const s3 = new S3Client(args.creds);
	return await s3.getPresignedUrl(`PUT`, args.objectKey, {
		expirySeconds: args.expirySeconds ?? 300
	});
}

/**
 * Uploads an image to a deterministic R2 object key.
 *
 * @example
 * await uploadImageAtObjectKey(Buffer.from([]), `profiles/user/profile.webp`, creds)
 */
export async function uploadImageAtObjectKey(buffer: Buffer, objectKey: string, creds: S3Creds, contentType = `image/webp`) {
	if (!buffer || buffer.length === 0) throw new Error(`Cannot upload empty buffer`);
	if (!objectKey || !objectKey.trim()) throw new Error(`Object key cannot be empty`);

	try {
		const s3 = new S3Client(creds);
		await s3.putObject(objectKey, buffer, { metadata: { 'Content-Type': contentType } });
		console.log(`Uploaded to R2 ${objectKey}`);

		return publicUrl(objectKey);
	} catch (error) {
		console.error(`Error uploading image ${objectKey}:`, error);
		throw error;
	}
}

/**
 * Uploads an image to R2 storage.
 * @param buffer - The image buffer to upload
 * @param eventSlug - The event slug for organizing images
 * @param phash - The perceptual hash for the image
 * @param creds - R2 credentials
 * @param contentType - The uploaded image MIME type
 * @returns Promise with the upload result containing secure_url
 */
export async function uploadEventImage(buffer: Buffer, eventSlug: string, phash: string, creds: S3Creds, contentType = `image/webp`) {
	if (!buffer || buffer.length === 0) throw new Error(`Cannot upload empty buffer`);
	if (!eventSlug || !eventSlug.trim()) throw new Error(`Event slug cannot be empty`);
	if (!phash || !phash.trim()) throw new Error(`Phash cannot be empty`);

	const key = eventImageObjectKey(eventSlug, phash, contentType);
	return await uploadImageAtObjectKey(buffer, key, creds, contentType);
}

/**
 * Uploads a public profile avatar image to its deterministic R2 key.
 */
export async function uploadProfileImage(args: UploadProfileImageArgs) {
	if (!args.profileId?.trim()) throw new Error(`Profile id cannot be empty`);

	return await uploadImageAtObjectKey(
		args.buffer,
		publicProfileImageObjectKey(args.profileId, `profile`, args.contentType),
		args.creds,
		args.contentType
	);
}

/**
 * Uploads a public profile banner image to its deterministic R2 key.
 */
export async function uploadProfileBannerImage(args: UploadProfileImageArgs) {
	if (!args.profileId?.trim()) throw new Error(`Profile id cannot be empty`);

	return await uploadImageAtObjectKey(
		args.buffer,
		publicProfileImageObjectKey(args.profileId, `banner`, args.contentType),
		args.creds,
		args.contentType
	);
}

/**
 * Deletes multiple objects from R2 storage.
 * @param objectKeys - Array of image keys to delete or URLs
 * @param creds - R2 credentials
 * @returns Promise with deletion results
 */
export async function deleteObjects(objectKeys: string[], creds: S3Creds) {
	if (!objectKeys?.length) {
		console.log(`No public IDs provided for deletion`);
		return [];
	}

	objectKeys = objectKeys.map((x) => objectKeyFromPublicUrl(x) ?? x);
	console.log(`Deleting from R2: ${objectKeys}`);

	try {
		const s3 = new S3Client(creds);
		await Promise.all(objectKeys.map((x) => s3.deleteObject(x.trim())));
		console.log(`Deletion completed`);
	} catch (error) {
		console.error(`Error in deleteImages:`, error);
		throw error;
	}
}

/**
 * Lists all images from R2 storage.
 * @param creds - R2 credentials
 * @returns Promise with array of all image metadata
 */
export async function getAllImageData(creds: S3Creds): Promise<Image[]> {
	console.log(`Fetching meta data for all images in R2...`);

	try {
		const s3 = new S3Client(creds);
		const res = await s3.listObjects();

		const results: { public_id: string; secure_url: string; created_at: string; bytes: number; format: string }[] = [];
		for await (const obj of res) {
			results.push({
				public_id: obj.key || ``,
				secure_url: publicUrl(obj.key || ``),
				created_at: obj.lastModified?.toISOString(),
				bytes: obj.size || 0,
				format: obj.key?.split(`.`).pop() || `unknown`,
			});
		}

		console.log(`Found ${results.length} total images in R2`);

		return results;
	} catch (error) {
		console.error(`Error fetching R2 images:`, error);
		throw error;
	}
}

/**
 * Checks if an object exists in R2 storage.
 * @param objectKey - The object key to check
 * @param creds - R2 credentials
 * @returns Promise with boolean indicating if the object exists
 */
export function exists(objectKey: string, creds: S3Creds) {
	return new S3Client(creds).exists(objectKey);
}

/**
 * Maps an uploaded image MIME type to the stored object extension.
 * @example
 * getImageObjectExtensionFromMimeType(`image/jpeg`);
 */
function getImageObjectExtensionFromMimeType(contentType: string) {
	if (contentType === `image/jpeg`) return `jpg`;
	if (contentType === `image/webp`) return `webp`;
	throw new Error(`Unsupported image content type: ${contentType || `unknown`}`);
}

type UploadProfileImageArgs = {
	buffer: Buffer;
	profileId: string;
	creds: S3Creds;
	contentType?: string;
};