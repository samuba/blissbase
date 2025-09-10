import { db, s } from '../src/lib/server/db';
import { isNotNull, sql, and } from 'drizzle-orm';
import 'dotenv/config';
import * as cloudinary from '../src/lib/cloudinary';

/**
 * Fetches all image URLs referenced in events from the database.
 */
async function getReferencedImageUrls(): Promise<Set<string>> {
    console.log('Fetching referenced image URLs from events...');

    const events = await db.select({
        imageUrls: s.events.imageUrls
    }).from(s.events)
        .where(and(isNotNull(s.events.imageUrls), sql`array_length(${s.events.imageUrls}, 1) > 0`));

    const referencedUrls = new Set<string>();

    for (const event of events) {
        if (event.imageUrls) {
            for (const url of event.imageUrls) {
                if (url && url.trim()) {
                    referencedUrls.add(url.trim());
                }
            }
        }
    }

    console.log(`Found ${referencedUrls.size} referenced unique image URLs`);
    return referencedUrls;
}

/**
 * Identifies images that are not referenced in any event.
 */
function findUnreferencedImages(cloudinaryImages: cloudinary.Image[], referencedUrls: Set<string>): cloudinary.Image[] {
    console.log('Identifying unreferenced images...');

    const unreferencedImages: cloudinary.Image[] = [];

    for (const image of cloudinaryImages) {
        // Check if this image's URL is referenced in any event
        const isReferenced = referencedUrls.has(image.secure_url);

        if (!isReferenced) {
            unreferencedImages.push(image);
        }
    }

    console.log(`Found ${unreferencedImages.length} unreferenced images`);
    return unreferencedImages;
}

/**
 * Calculates total storage savings from deleted images.
 */
function calculateStorageSavings(images: cloudinary.Image[]): { totalBytes: number; totalMB: number } {
    const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
    const totalMB = Math.round(totalBytes / (1024 * 1024) * 100) / 100;

    return { totalBytes, totalMB };
}

/**
 * Main function to clean up unused images with improved error handling and safety checks.
 */
async function cleanupUnusedImages(dryRun: boolean = false): Promise<void> {
    console.log('Starting unused image cleanup process...');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no images will be deleted)' : 'LIVE RUN (images will be deleted)'}`);
    console.log('');

    try {
        // Step 1: Get all referenced image URLs from events
        console.log('Step 1: Fetching referenced image URLs...');
        const referencedUrls = await getReferencedImageUrls();

        if (referencedUrls.size === 0) {
            console.log('⚠️ No referenced image URLs found. This might indicate a problem with the database query.');
            return;
        }

        // Step 2: Get all images from Cloudinary
        console.log('Step 2: Fetching all images from Cloudinary...');
        const cloudinaryImages = await cloudinary.getAllImageData(cloudinary.loadCreds());

        if (cloudinaryImages.length === 0) {
            console.log('⚠️ No images found in Cloudinary. Nothing to clean up.');
            return;
        }

        // Step 3: Find unreferenced images
        console.log('Step 3: Identifying unreferenced images...');
        const unreferencedImages = findUnreferencedImages(cloudinaryImages, referencedUrls);

        if (unreferencedImages.length === 0) {
            console.log('🎉 No unused images found! All images are referenced in events.');
            return;
        }

        // Step 4: Show summary
        const { totalMB } = calculateStorageSavings(unreferencedImages);
        console.log(`\n📊 Summary:`);
        console.log(`   Total images in Cloudinary: ${cloudinaryImages.length}`);
        console.log(`   Referenced images: ${cloudinaryImages.length - unreferencedImages.length}`);
        console.log(`   Unreferenced images: ${unreferencedImages.length}`);
        console.log(`   Potential storage savings: ${totalMB} MB`);
        console.log('');

        // Step 5: Show some examples of unreferenced images
        console.log('📋 Examples of unreferenced images:');
        unreferencedImages.slice(0, 5).forEach((image, index) => {
            console.log(`   ${index + 1}. ${image.public_id} (${Math.round(image.bytes / 1024)} KB)`);
        });
        if (unreferencedImages.length > 5) {
            console.log(`   ... and ${unreferencedImages.length - 5} more`);
        }
        console.log('');

        if (dryRun) {
            console.log('🔍 DRY RUN: No images were deleted. Run without --dry-run to actually delete images.');
            return;
        }

        // Safety check: Don't delete if there are too many unreferenced images
        const maxDeletions = 1000;
        if (unreferencedImages.length > maxDeletions) {
            console.error(`❌ Safety check failed: Too many unreferenced images (${unreferencedImages.length}). Maximum allowed: ${maxDeletions}`);
            console.error('This might indicate a problem with the reference detection. Please investigate manually.');
            process.exit(1);
        }

        // Step 6: Delete unreferenced images in batches
        console.log('Step 6: Deleting unreferenced images in Cloudinary...');
        const publicIds = unreferencedImages.map(image => image.public_id).filter(id => id && id.trim());

        if (publicIds.length === 0) {
            console.log('⚠️ No valid public IDs found for deletion.');
            return;
        }

        console.log(`Deleting ${publicIds.length} images...`);
        await cloudinary.deleteImages(publicIds, cloudinary.loadCreds());

        console.log('\n✅ Cleanup completed successfully!');

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

// Run the script
if (import.meta.main) {
    cleanupUnusedImages(dryRun).catch(console.error);
}
