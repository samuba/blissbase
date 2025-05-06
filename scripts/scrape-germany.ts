/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: bun run scripts/scrape-germany.ts
 */

import { sql, eq } from 'drizzle-orm'; // Import sql and eq from drizzle-orm directly
import type { ScrapedEvent } from '../src/lib/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { scrapeAwaraEvents } from './scrape-awara.ts';
import { scrapeTribehausEvents } from './scrape-tribehaus.ts';
import { scrapeHeilnetzEvents } from './scrape-heilnetz.ts';
import { db } from "../src/lib/server/db.ts";

// Map argument names (lowercase) to the expected host names used in the DB
const SOURCE_HOST_MAP: Record<string, string> = {
    'awara': 'Awara',
    'tribehaus': 'Tribehaus',
    'heilnetz': 'Heilnetz',
};
const VALID_SOURCES = Object.keys(SOURCE_HOST_MAP);

console.log('--- Starting Germany Event Scraper ---');

// --- Process Arguments ---
const args = process.argv.slice(2);
let targetSourceArg: string | null = null;
let targetHostName: string | null = null;

if (args.length > 0) {
    const sourceArgLower = args[0].toLowerCase();
    if (VALID_SOURCES.includes(sourceArgLower)) {
        targetSourceArg = sourceArgLower;
        targetHostName = SOURCE_HOST_MAP[sourceArgLower];
        console.log(`Targeting single source: ${targetHostName}`);
    } else {
        console.warn(`Invalid source argument: ${args[0]}. Valid sources are: ${VALID_SOURCES.join(', ')}. Scraping all sources.`);
    }
} else {
    console.log('No source specified, scraping all sources.');
}

let allEvents: ScrapedEvent[] = [];

// --- Run Scrapers ---
if (!targetSourceArg || targetSourceArg === 'awara') {
    try {
        console.log('Scraping Awara...');
        const awaraEvents = await scrapeAwaraEvents();
        console.log(` -> Found ${awaraEvents.length} events.`);
        allEvents = allEvents.concat(awaraEvents);
    } catch (error) {
        console.error('Error scraping Awara:', error);
    }
}

if (!targetSourceArg || targetSourceArg === 'tribehaus') {
    try {
        console.log('Scraping Tribehaus...');
        const tribehausEvents = await scrapeTribehausEvents();
        console.log(` -> Found ${tribehausEvents.length} events.`);
        allEvents = allEvents.concat(tribehausEvents);
    } catch (error) {
        console.error('Error scraping Tribehaus:', error);
    }
}

if (!targetSourceArg || targetSourceArg === 'heilnetz') {
    try {
        console.log('Scraping Heilnetz...');
        const heilnetzEvents = await scrapeHeilnetzEvents();
        console.log(` -> Found ${heilnetzEvents.length} events.`);
        allEvents = allEvents.concat(heilnetzEvents);
    } catch (error) {
        console.error('Error scraping Heilnetz:', error);
    }
}

console.log(`--- Total events scraped this run: ${allEvents.length} ---`);

if (allEvents.length === 0) {
    console.log('No events scraped. Exiting.');
    process.exit(0);
}

// --- Connect to Database and Insert Data ---
console.log('Connecting to PostgreSQL database...');

// Simple migration check
console.log('Ensuring database table exists...');
try {
    // This is a simple check; ideally, use drizzle-kit push/generate
    await db.select({ id: schema.events.id }).from(schema.events).limit(1);
    console.log("Table 'events' seems to exist.");
} catch (e) {
    console.error("Failed to check table existence or table doesn't exist.", e);
    console.error("Please ensure the database schema is created. You might need to run 'npx drizzle-kit push:postgres'.");
    process.exit(0); // Stop if we can't confirm table existence
}

// --- Clear existing data (conditionally) ---
if (targetHostName) {
    console.log(`Clearing existing events from source '${targetHostName}'...`);
    try {
        await db.delete(schema.events).where(eq(schema.events.host, targetHostName));
        console.log(` -> Existing events for host '${targetHostName}' cleared (if any existed).`);
    } catch (error) {
        console.error(`Error clearing existing events for source '${targetHostName}':`, error);
        process.exit(0);
    }
} else {
    console.log('Clearing ALL existing events from the database...');
    try {
        await db.delete(schema.events);
        console.log(' -> Existing events cleared successfully.');
    } catch (error) {
        console.error('Error clearing existing events:', error);
        process.exit(0);
    }
}
// --- End Clear existing data ---


console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

// Prepare data for insertion, mapping ScrapedEvent to the schema format
const eventsToInsert = allEvents.map(event => ({
    name: event.name,
    startAt: event.startAt ? new Date(event.startAt) : null,
    endAt: event.endAt ? new Date(event.endAt) : null,
    address: event.address,
    price: event.price,
    description: event.description,
    imageUrls: event.imageUrls,
    host: event.host,
    hostLink: event.hostLink,
    permalink: event.permalink,
    latitude: event.latitude,
    longitude: event.longitude,
    tags: event.tags,
    // scrapedAt is handled by default value in schema
}));

await Bun.write('events.json', JSON.stringify(eventsToInsert, null, 2));

try {
    let successCount = 0;

    // Insert events one by one instead of in bulk
    for (const event of eventsToInsert) {
        try {
            event.tags = [...new Set(event.tags)] // Ensure tags are unique
            // Use insert with onConflictDoUpdate to handle potential duplicate permalinks
            await db.insert(schema.events)
                .values(event as unknown as typeof schema.events.$inferInsert)
                .onConflictDoUpdate({
                    target: schema.events.permalink, // Conflict target
                    set: { // Update all fields except permalink and scrapedAt
                        name: sql`excluded.name`,
                        startAt: sql`excluded.start_at`,
                        endAt: sql`excluded.end_at`,
                        address: sql`excluded.address`,
                        price: sql`excluded.price`,
                        description: sql`excluded.description`,
                        imageUrls: sql`excluded.image_urls`,
                        host: sql`excluded.host`,
                        hostLink: sql`excluded.host_link`,
                        latitude: sql`excluded.latitude`,
                        longitude: sql`excluded.longitude`,
                        tags: sql`excluded.tags`,
                        // Update scrapedAt timestamp on update as well
                        scrapedAt: sql`CURRENT_TIMESTAMP`,
                    }
                })
                .returning({ insertedId: schema.events.id });

            successCount++;

            // Log progress every 10 events
            if (successCount % 10 === 0) {
                console.log(` -> Progress: ${successCount}/${eventsToInsert.length} events processed`);
            }
        } catch (error) {
            console.error(`Error inserting event "${event.name}":`, error);
        }
    }

    console.log(` -> Successfully inserted/updated ${successCount} out of ${eventsToInsert.length} events.`);

} catch (error) {
    console.error('Error in event insertion process:', error);
} finally {
    console.log('Database connection closed.');
}

console.log('--- Germany Event Scraper Finished ---');

