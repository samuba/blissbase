import 'dotenv/config';
import { db, s } from '../src/lib/server/db';
import { eq } from 'drizzle-orm';

const events = await db.select().from(s.events);
const BATCH_SIZE = 20;

console.log(`Processing ${events.length} events in batches of ${BATCH_SIZE}`);

for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(events.length / BATCH_SIZE)} (events ${i + 1}-${Math.min(i + BATCH_SIZE, events.length)})`);

    const updates = batch.map(event => {
        const newImageUrls = event.imageUrls?.map(url => {
            const [file, slug] = url?.split('/')?.reverse() ?? [];
            const phash = file?.split('.')?.[0] ?? '';
            return `https://assets.blissbase.app/events/${slug}/${phash}.webp`;
        }) ?? [];
        console.log(`  id ${event.id}`, newImageUrls);
        return db.update(s.events).set({ imageUrls: newImageUrls }).where(eq(s.events.id, event.id));
    });

    await Promise.all(updates);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
}

console.log(`\nDone! Processed ${events.length} events`);

process.exit(0);