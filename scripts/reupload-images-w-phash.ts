/**
 * 
 * This script processes thousands of images efficiently by:
 * - Processing images in batches (50 at a time) to avoid memory overflow
 * - Caching images locally to avoid re-downloading for upload
 * - Monitoring memory usage and forcing garbage collection
 * - Using Bun.write for fast file operations
 */

import { db, s } from '../src/lib/server/db';
import * as cloudinary from '../src/lib/cloudinary';
import { eq, isNotNull, sql, and } from 'drizzle-orm';
import 'dotenv/config';
import { calculatePhash } from '../src/lib/imageProcessing';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { customFetch } from './common';


type ImageInfo = {
    oldUrl: string;
    newUrl: string;
    phash: string;
    eventId: number;
    eventSlug: string;
    imageIndex: number;
    localPath: string; // Path to locally cached image
}

// Global temp directory for image caching
const TEMP_DIR = join(process.cwd(), 'temp', 'image-cache');

/**
 * Initializes the temporary directory for image caching.
 */
async function initializeTempDir(): Promise<void> {
    try {
        await mkdir(TEMP_DIR, { recursive: true });
        console.log(`Initialized temp directory: ${TEMP_DIR}`);
    } catch (error) {
        console.error('Failed to create temp directory:', error);
        throw error;
    }
}

/**
 * Cleans up the temporary directory after processing.
 */
async function cleanupTempDir(): Promise<void> {
    try {
        await rm(TEMP_DIR, { recursive: true, force: true });
        console.log(`Cleaned up temp directory: ${TEMP_DIR}`);
    } catch (error) {
        console.error('Failed to clean up temp directory:', error);
        // Don't throw here as it's cleanup
    }
}

/**
 * Downloads an image from a URL, stores it locally, and returns its hash.
 */
async function downloadAndHashImage(url: string, eventId: number, imageIndex: number, eventSlug: string): Promise<ImageInfo | null> {
    try {
        console.log(`Downloading image ${imageIndex} from event ${eventId}: ${url}`);

        // Extract filename from URL (last part after the last slash)
        const urlParts = url.split('/');
        let filename = urlParts[urlParts.length - 1];

        // If no extension, add .jpg as default
        if (!filename.includes('.')) {
            filename += '.jpg';
        }

        // Clean filename to be filesystem-safe
        filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

        // Handle potential filename conflicts by adding a counter
        let localPath = join(TEMP_DIR, filename);
        let counter = 1;
        while (true) {
            try {
                await Bun.file(localPath).arrayBuffer();
                // File exists, try with counter
                const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
                const ext = filename.match(/\.[^/.]+$/)?.[0] || '';
                localPath = join(TEMP_DIR, `${nameWithoutExt}_${counter}${ext}`);
                counter++;
            } catch {
                // File doesn't exist, we can use this path
                break;
            }
        }

        let buffer: Buffer;

        // Check if image is already cached locally
        try {
            const file = Bun.file(localPath);
            if (await file.exists()) {
                buffer = Buffer.from(await file.arrayBuffer());
                console.log(`Using cached image: ${localPath}`);
            } else {
                throw new Error('File does not exist');
            }
        } catch {
            // Download and cache the image
            buffer = Buffer.from(await customFetch(url, { returnType: 'bytes' }));
            await Bun.write(localPath, buffer);
            console.log(`Cached image to: ${localPath}`);
        }

        const phash = await calculatePhash(buffer);

        return {
            oldUrl: url,
            newUrl: '',
            phash,
            eventId,
            imageIndex,
            eventSlug,
            localPath
        };
    } catch (error) {
        console.error(`Error downloading/hashing image ${url}:`, error);
        return null;
    }
}

/**
 * Processes images in batches to avoid memory issues.
 */
async function processImagesInBatches(
    allImageUrls: string[],
    eventImageMap: Map<string, { eventId: number; imageIndex: number, eventSlug: string }>,
    batchSize: number = 50
): Promise<ImageInfo[]> {
    const allImageInfos: ImageInfo[] = [];
    const totalBatches = Math.ceil(allImageUrls.length / batchSize);

    console.log(`Processing ${allImageUrls.length} images in ${totalBatches} batches of ${batchSize}`);

    for (let i = 0; i < allImageUrls.length; i += batchSize) {
        const batch = allImageUrls.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)`);

        const batchPromises = batch.map(async (url) => {
            const eventInfo = eventImageMap.get(url)!;
            return downloadAndHashImage(url, eventInfo.eventId, eventInfo.imageIndex, eventInfo.eventSlug);
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((x) => x !== null);
        allImageInfos.push(...validResults);

        // Log memory usage
        const used = process.memoryUsage();
        console.log(`Batch ${batchNumber} completed. Memory usage: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }

    return allImageInfos;
}

async function run(): Promise<void> {
    console.log('Starting image reupload process...');

    try {
        // Initialize temp directory for image caching
        await initializeTempDir();
        // Fetch all events with imageUrls
        console.log('Fetching events from database...');
        const events = await db.query.events.findMany({
            where: and(isNotNull(s.events.imageUrls), sql`array_length(${s.events.imageUrls}, 1) > 0`)
        });

        console.log(`Found ${events.length} events with images`);
        if (events.length === 0) {
            console.log('No events with images found. Exiting.');
            return;
        }

        // Collect all unique image URLs
        const allImageUrls = new Set<string>();
        const eventImageMap = new Map<string, { eventId: number; imageIndex: number, eventSlug: string }>();
        for (const event of events) {
            if (event.imageUrls) {
                for (let i = 0; i < event.imageUrls.length; i++) {
                    const url = event.imageUrls[i];
                    if (url && !allImageUrls.has(url)) {
                        allImageUrls.add(url);
                        eventImageMap.set(url, { eventId: event.id, imageIndex: i, eventSlug: event.slug });
                    }
                }
            }
        }
        console.log(`Found ${allImageUrls.size} unique image URLs`);
        if (allImageUrls.size === 0) {
            console.log('No image URLs found. Exiting.');
            return;
        }

        // Process images in batches to avoid memory issues
        const imageInfos = await processImagesInBatches(Array.from(allImageUrls), eventImageMap);
        console.log(`Successfully processed ${imageInfos.length} images`);
        if (imageInfos.length === 0) {
            console.log('No images could be processed. Exiting.');
            return;
        }
        // reupload images to cloudinary
        for (const imageInfo of imageInfos) {
            const buffer = Buffer.from(await Bun.file(imageInfo.localPath).arrayBuffer());
            const uploadedImage = await cloudinary.uploadImage(buffer, imageInfo.eventSlug, imageInfo.phash, cloudinary.loadCreds());
            imageInfo.newUrl = uploadedImage.secure_url;

            if (imageInfo.oldUrl.split("https://").length > 2) {
                // this is an image from a scraped website, put it also into the image cache map
                await db.insert(s.imageCacheMap).values({
                    originalUrl: imageInfo.oldUrl,
                    eventSlug: imageInfo.eventSlug,
                    url: uploadedImage.secure_url
                });
                console.log(`Added image ${imageInfo.oldUrl} to image cache map`);
            }
            console.log(`Uploaded image ${imageInfos.indexOf(imageInfo) + 1}/${imageInfos.length} to cloudinary: ${imageInfo.oldUrl}`);
        }


        // Update events with new image URLs using transactions
        console.log('Updating events with new image URLs...');
        let updatedEvents = 0;
        let failedUpdates = 0;

        for (const event of events) {
            try {
                if (event.imageUrls?.length ?? 0 > 0) {
                    const newImageUrls = imageInfos.filter(x => x.eventSlug === event.slug).map(x => x.newUrl);
                    const hasChanges = newImageUrls.some((url, index) => url !== event.imageUrls![index]);
                    if (hasChanges) {
                        console.log(`Updating event ${event.id} with ${newImageUrls.length} images`);
                        await db.update(s.events)
                            .set({ imageUrls: newImageUrls })
                            .where(eq(s.events.id, event.id));
                        updatedEvents++;
                    }
                }
            } catch (error) {
                console.error(`Failed to update event ${event.id}:`, error);
                failedUpdates++;
                // Continue with other events
            }
        }

        console.log(`Updated ${updatedEvents} events successfully, ${failedUpdates} failed`);
        console.log('Image deduplication completed successfully!');
        await cleanupTempDir();

    } catch (error) {
        console.error('Fatal error during image deduplication:', error);
        throw error;
    }
}

// Run the script
if (import.meta.main) {
    run().catch(console.error);
}