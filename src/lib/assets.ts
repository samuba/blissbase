import { S3Client } from "@bradenmacdonald/s3-lite-client";

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

export function eventImageObjectKey(eventSlug: string, phash: string) {
    return `events/${eventSlug}/${phash}.webp`;
}

function publicUrl(objectKey: string) {
    return `https://assets.blissbase.app/${objectKey}`;
}

/**
 * Uploads an image to R2 storage.
 * @param buffer - The image buffer to upload
 * @param eventSlug - The event slug for organizing images
 * @param phash - The perceptual hash for the image
 * @param creds - R2 credentials
 * @returns Promise with the upload result containing secure_url
 */
export async function uploadImage(buffer: Buffer, eventSlug: string, phash: string, creds: S3Creds) {
    if (!buffer || buffer.length === 0) throw new Error(`Cannot upload empty buffer`);
    if (!eventSlug || !eventSlug.trim()) throw new Error(`Event slug cannot be empty`);
    if (!phash || !phash.trim()) throw new Error(`Phash cannot be empty`);

    const key = eventImageObjectKey(eventSlug, phash);
    try {
        const s3 = new S3Client(creds);
        await s3.putObject(key, buffer, { metadata: { 'Content-Type': 'image/webp' } });
        console.log(`Uploaded to R2 ${key}`);

        return publicUrl(key);
    } catch (error) {
        console.error(`Error uploading image ${key}:`, error);
        throw error;
    }
}

/**
 * Deletes multiple images from R2 storage.
 * @param objectKeys - Array of image keys to delete
 * @param creds - R2 credentials
 * @returns Promise with deletion results
 */
export async function deleteImages(objectKeys: string[], creds: S3Creds) {
    if (!objectKeys?.length) {
        console.log(`No public IDs provided for deletion`);
        return [];
    }
    console.log(`Deleting ${objectKeys.length} images from R2`);

    try {
        const s3 = new S3Client(creds);
        await Promise.all(objectKeys.map(x => s3.deleteObject(x.trim())));
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

        const results: { public_id: string, secure_url: string, created_at: string, bytes: number, format: string }[] = [];
        for await (const obj of res) {
            results.push({
                public_id: obj.key || '',
                secure_url: publicUrl(obj.key || ''),
                created_at: obj.lastModified?.toISOString(),
                bytes: obj.size || 0,
                format: obj.key?.split('.').pop() || 'unknown',
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