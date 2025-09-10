export type CloudinaryCreds = { apiKey: string, cloudName: string, apiSecret: string };

export function loadCreds() {
    return {
        apiKey: process.env.CLOUDINARY_API_KEY!,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
        apiSecret: process.env.CLOUDINARY_API_SECRET!
    };
}

export async function deleteImages(publicIds: string[], creds: CloudinaryCreds) {
    if (!publicIds?.length) {
        console.log('No public IDs provided for deletion');
        return [];
    }

    // Process in batches of 100 (Cloudinary's limit)
    const batchSize = 100;
    const results: unknown[] = [];
    let successCount = 0;
    let failureCount = 0;

    console.log(`Deleting ${publicIds.length} images in batches of ${batchSize}`);

    for (let i = 0; i < publicIds.length; i += batchSize) {
        const batch = publicIds.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        try {
            // Create form data with public_ids[] array format
            const formData = new FormData();
            batch.forEach(id => {
                if (id && id.trim()) {
                    formData.append('public_ids[]', id.trim());
                }
            });

            const res = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/resources/image/upload`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Basic ${btoa(`${creds.apiKey}:${creds.apiSecret}`)}`
                },
                body: formData,
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error(`Failed to delete images batch ${batchNumber}: ${res.status} ${res.statusText} - ${errorText}`);
                failureCount += batch.length;
                continue;
            }

            const result = await res.json();
            results.push(result);
            successCount += batch.length;

            console.log(`Batch ${batchNumber} deleted successfully (${batch.length} images)`);

            // Add small delay to avoid rate limiting
            if (i + batchSize < publicIds.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error(`Error deleting batch ${batchNumber}:`, error);
            failureCount += batch.length;
        }
    }

    console.log(`Deletion completed: ${successCount} successful, ${failureCount} failed`);
    return results;
}

export interface Image {
    public_id: string;
    secure_url: string;
    created_at: string;
    bytes: number;
    format: string;
}

/**
 * Lists all images from Cloudinary with pagination support.
 */
export async function getAllImageData(creds: CloudinaryCreds): Promise<Image[]> {
    console.log('Fetching meta data for all images in Cloudinary...');
    const allImages: Image[] = [];
    let nextCursor: string | undefined;
    let pageCount = 0;
    const maxPages = 1000; // Safety limit to prevent infinite loops

    try {
        do {
            pageCount++;
            if (pageCount > maxPages) {
                console.warn(`Reached maximum page limit (${maxPages}). Stopping pagination.`);
                break;
            }

            const url = new URL(`https://api.cloudinary.com/v1_1/${creds.cloudName}/resources/image`);
            url.searchParams.set('max_results', '500');
            if (nextCursor) {
                url.searchParams.set('next_cursor', nextCursor);
            }

            console.log(`Fetching page ${pageCount}${nextCursor ? ` (cursor: ${nextCursor.substring(0, 20)}...)` : ''}`);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64')}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch Cloudinary images page ${pageCount}: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data: {
                resources: Image[];
                next_cursor?: string;
            } = await response.json();

            if (!data.resources || !Array.isArray(data.resources)) {
                console.warn(`Invalid response format on page ${pageCount}. Expected resources array.`);
                break;
            }

            allImages.push(...data.resources);
            nextCursor = data.next_cursor;

            console.log(`Page ${pageCount}: Found ${data.resources.length} images (total: ${allImages.length})`);

            // Add small delay to avoid rate limiting
            if (nextCursor) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } while (nextCursor);

        console.log(`Found ${allImages.length} total images in Cloudinary across ${pageCount} pages`);
        return allImages;
    } catch (error) {
        console.error('Error fetching Cloudinary images:', error);
        throw error;
    }
}

export async function uploadImage(buffer: Buffer, eventSlug: string, phash: string, creds: CloudinaryCreds) {
    if (!buffer || buffer.length === 0) throw new Error('Cannot upload empty buffer');
    if (!eventSlug || !eventSlug.trim()) throw new Error('Event slug cannot be empty');
    if (!phash || !phash.trim()) throw new Error('Phash cannot be empty');

    const publicId = `${eventSlug}/${phash}`;
    try {
        const formData = new FormData();
        formData.append("file", new Blob([buffer]), `${publicId}.jpg`);
        formData.append("api_key", creds.apiKey!);
        formData.append("upload_preset", "blissbase");
        formData.append("resource_type", "image");
        formData.append("public_id", publicId.trim());

        const res = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to upload to Cloudinary: ${res.status} ${res.statusText} - ${errorText} (buffer length: ${buffer.length})`);
        }

        const result = await res.json() as { secure_url: string };

        if (!result.secure_url) {
            throw new Error('Upload successful but no secure_url returned');
        }

        return result;
    } catch (error) {
        console.error(`Error uploading image ${publicId}:`, error);
        throw error;
    }
}
