import * as assets from '../src/lib/assets';
import 'dotenv/config';
import { db, s } from '../src/lib/server/db';
import { desc } from 'drizzle-orm';

const urls = new Set<string>();
const events = await db.select().from(s.events);
events.forEach(event => {
    if (event.imageUrls) {
        event.imageUrls.forEach(imageUrl => {
            if (imageUrl) {
                urls.add(imageUrl);
            }
        });
    }
});

console.log("found", urls.size, "urls")

const concurrency = 20;
const urlsArr = Array.from(urls);
let processed = 0;

async function processImage(url: string) {
    try {
        const [file, slug] = url.split("/").reverse();
        const phash = file.split(".")[0];
        const res = await fetch(url);
        if (!res.ok) {
            console.error("Error fetching", url, res.status, res.statusText);
            return "error"
        }
        const exists = await assets.exists(assets.eventImageObjectKey(slug, phash), assets.loadCreds());
        if (exists) {
            console.log("image already exists. skipping", url);
            return "exists"
        }
        await assets.uploadImage(Buffer.from(await res.arrayBuffer()), slug, phash, assets.loadCreds());
        return "uploaded"
    } catch (err) {
        console.error("Error processing", url, err);
    } finally {
        processed++;
        if (processed % 50 === 0) {
            console.log(`Progress: processed ${processed} images`);
        }
    }
}

async function runInBatches(urls: string[], batchSize: number) {
    const results: string[] = [];
    let idx = 0;
    while (idx < urls.length) {
        const batch = urls.slice(idx, idx + batchSize);
        const batchResults = await Promise.all(batch.map(url => processImage(url)));
        results.push(...batchResults.filter(Boolean) as string[]);
        idx += batchSize;
    }
    return results;
}

const results = await runInBatches(urlsArr, concurrency);

// Count results
const stats = {
    exists: results.filter(r => r === `exists`).length,
    error: results.filter(r => r === `error`).length,
    uploaded: results.filter(r => r === `uploaded`).length
};

console.log(`\nDone! Results:`);
console.log(`  Exists: ${stats.exists}`);
console.log(`  Error: ${stats.error}`);
console.log(`  Uploaded: ${stats.uploaded}`);
console.log(`  Total processed: ${results.length}`)

