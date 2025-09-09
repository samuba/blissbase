export async function deleteImages(publicIds: string[]) {
    const cred = {
        apiKey: process.env.CLOUDINARY_API_KEY!,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
        apiSecret: process.env.CLOUDINARY_API_SECRET!
    };

    // Process in batches of 100 (Cloudinary's limit)
    const batchSize = 100;
    const results: any[] = [];

    for (let i = 0; i < publicIds.length; i += batchSize) {
        const batch = publicIds.slice(i, i + batchSize);

        // Create form data with public_ids[] array format
        const formData = new FormData();
        batch.forEach(id => formData.append('public_ids[]', id));

        const res = await fetch(`https://api.cloudinary.com/v1_1/${cred.cloudName}/resources/image/upload`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Basic ${btoa(`${cred.apiKey}:${cred.apiSecret}`)}`
            },
            body: formData,
        });

        if (!res.ok) {
            throw new Error(`Failed to delete images batch ${i / batchSize + 1}: ${res.status} ${res.statusText}`);
        }

        const result = await res.json();
        results.push(result);
    }

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
export async function getAllImageData(): Promise<Image[]> {
    const creds = {
        apiKey: process.env.CLOUDINARY_API_KEY!,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
        apiSecret: process.env.CLOUDINARY_API_SECRET!
    };

    if (!creds.apiKey || !creds.cloudName || !creds.apiSecret) {
        throw new Error('CLOUDINARY_API_KEY, CLOUDINARY_CLOUD_NAME, and CLOUDINARY_API_SECRET must be set');
    }

    console.log('Fetching meta data for all images in Cloudinary...');
    const allImages: Image[] = [];
    let nextCursor: string | undefined;

    do {
        const url = new URL(`https://api.cloudinary.com/v1_1/${creds.cloudName}/resources/image`);
        url.searchParams.set('max_results', '500');
        if (nextCursor) {
            url.searchParams.set('next_cursor', nextCursor);
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64')}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch Cloudinary images: ${response.status} ${response.statusText}`);
        }

        const data: {
            resources: Image[];
            next_cursor?: string;
        } = await response.json();
        allImages.push(...data.resources);
        nextCursor = data.next_cursor;
    } while (nextCursor);

    console.log(`Found ${allImages.length} total images in Cloudinary`);
    return allImages;
}