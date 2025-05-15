/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-germany.ts
 * bun run scripts/scrape-germany.ts awara
 */

import { sql, eq } from 'drizzle-orm'; // Import sql and eq from drizzle-orm directly
import type { ScrapedEvent } from '../src/lib/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { AwaraScraper } from './scrape-awara.ts';
import { TribehausScraper } from './scrape-tribehaus.ts';
import { HeilnetzScraper } from './scrape-heilnetz.ts';
import { SeijetztScraper } from './scrape-seijetzt.ts';
import { db } from "../src/lib/server/db.ts";

const SOURCE_HOSTS = ['awara', 'tribehaus', 'heilnetz', 'seijetzt'];

console.log('--- Starting Germany Event Scraper ---');

// --- Process Arguments ---
const args = process.argv.slice(2);
let targetSourceArg: string | null = null;

if (args.length > 0) {
    const sourceArgLower = args[0].toLowerCase();
    if (SOURCE_HOSTS.includes(sourceArgLower)) {
        targetSourceArg = sourceArgLower;
        console.log(`Targeting single source: ${targetSourceArg}`);
    } else {
        console.warn(`Invalid source argument: ${args[0]}. Valid sources are: ${SOURCE_HOSTS.join(', ')}. Scraping all sources.`);
    }
} else {
    console.log('No source specified, scraping all sources.');
}

let allEvents: ScrapedEvent[] = [];

// --- Run Scrapers ---
if (!targetSourceArg || targetSourceArg === 'awara') {
    try {
        console.log('Scraping Awara...');
        const awaraEvents = await new AwaraScraper().scrapeWebsite();
        console.log(` -> Found ${awaraEvents.length} events.`);
        allEvents = allEvents.concat(awaraEvents);
    } catch (error) {
        console.error('Error scraping Awara:', error);
    }
}

if (!targetSourceArg || targetSourceArg === 'tribehaus') {
    try {
        console.log('Scraping Tribehaus...');
        const tribehausEvents = await new TribehausScraper().scrapeWebsite();
        console.log(` -> Found ${tribehausEvents.length} events.`);
        allEvents = allEvents.concat(tribehausEvents);
    } catch (error) {
        console.error('Error scraping Tribehaus:', error);
    }
}

if (!targetSourceArg || targetSourceArg === 'heilnetz') {
    try {
        console.log('Scraping Heilnetz...');
        const heilnetzEvents = await new HeilnetzScraper().scrapeWebsite();
        console.log(` -> Found ${heilnetzEvents.length} events.`);
        allEvents = allEvents.concat(heilnetzEvents);
    } catch (error) {
        console.error('Error scraping Heilnetz:', error);
    }
}

if (!targetSourceArg || targetSourceArg === 'seijetzt') {
    try {
        console.log('Scraping SeiJetzt...');
        const seijetztEvents = await new SeijetztScraper().scrapeWebsite();
        console.log(` -> Found ${seijetztEvents.length} events.`);
        allEvents = allEvents.concat(seijetztEvents);
    } catch (error) {
        console.error('Error scraping SeiJetzt:', error);
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
if (targetSourceArg) {
    console.log(`Clearing existing events from source '${targetSourceArg}'...`);
    try {
        const re = await db.delete(schema.events).where(eq(schema.events.host, targetSourceArg));
        console.log(` -> ${re.rowCount} existing events for host '${targetSourceArg}' cleared `);
    } catch (error) {
        console.error(`Error clearing existing events for source '${targetSourceArg}':`, error);
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
    ...event,
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

