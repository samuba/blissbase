/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz)
 * and store the results in a local SQLite database using Drizzle ORM.
 *
 * Requires Deno, --allow-net for scraping, --allow-read/--allow-write for the database file.
 * Usage: deno run --allow-net --allow-read --allow-write scripts/scrape-germany.ts
 */


import { sql, eq } from 'drizzle-orm'; // Import sql and eq from drizzle-orm directly
import { createClient } from '@libsql/client/node'; // Use standard client for Deno
// import { migrate } from "drizzle-orm/libsql/migrator"; // Removed unused import
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { ScrapedEvent } from '../src/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { scrapeAwaraEvents } from './scrape-awara.ts';
import { scrapeTribehausEvents } from './scrape-tribehaus.ts';
import { scrapeHeilnetzEvents } from './scrape-heilnetz.ts';
import { d1HttpDriver } from '../src/drizzle-d1-http.ts';
const DB_FILE = './scraped-events.db';

// Map argument names (lowercase) to the expected host names used in the DB
const SOURCE_HOST_MAP: Record<string, string> = {
    'awara': 'Awara',
    'tribehaus': 'Tribehaus',
    'heilnetz': 'Heilnetz',
};
const VALID_SOURCES = Object.keys(SOURCE_HOST_MAP);

async function main() {
    console.log('--- Starting Germany Event Scraper ---');

    // --- Process Arguments ---
    const args = Deno.args;
    let targetSourceArg: string | null = null;
    let targetHostName: string | null = null;

    if (args.length > 0) {
        const sourceArgLower = args[0].toLowerCase();
        if (VALID_SOURCES.includes(sourceArgLower)) {
            targetSourceArg = sourceArgLower;
            targetHostName = SOURCE_HOST_MAP[targetSourceArg];
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
        return;
    }

    // --- Connect to Database and Insert Data ---
    console.log(`Connecting to database: ${DB_FILE}`);

    const wrappedDriver: AsyncRemoteCallback = async (sql: string, params: unknown[], method: "all" | "run" | "get" | "values") => {
        if (method === "values") {
            const result = await d1HttpDriver(sql, params, "all");
            return result;
        }
        return d1HttpDriver(sql, params, method);
    };

    const client = createClient({ url: `file:${DB_FILE}` });
    const db = drizzle(wrappedDriver, { schema });

    // Simple migration (ensures table exists)
    // For more complex scenarios, use drizzle-kit generate/push
    console.log('Ensuring database table exists...');
    // NOTE: Drizzle migrator for libsql currently expects migrations in a specific folder structure.
    // For simplicity here, we'll just ensure the table exists via a basic query if needed,
    // or rely on the user running drizzle-kit push manually.
    // A more robust approach would be to generate migration files.
    try {
        // This is a simple check; ideally, use drizzle-kit push/generate
        await db.select({ id: schema.events.id }).from(schema.events).limit(1);
        console.log("Table 'events' seems to exist.");
    } catch (e) {
        console.error("Failed to check table existence or table doesn't exist.", e);
        console.error("Please ensure the database schema is created. You might need to run 'npx drizzle-kit push:sqlite' or similar.");
        // Alternatively, you could try creating the table directly here if it doesn't exist,
        // but using drizzle-kit is the recommended approach.
        client.close();
        return; // Stop if we can't confirm table existence
    }

    // --- Clear existing data (conditionally) ---
    if (targetHostName) {
        console.log(`Clearing existing events from source '${targetHostName}'...`);
        try {
            await db.delete(schema.events).where(eq(schema.events.host, targetHostName));
            // Note: deleteResult might not be informative depending on the driver, log count instead
            console.log(` -> Existing events for host '${targetHostName}' cleared (if any existed).`);
            // It's hard to know exactly how many were deleted without a count return, which isn't standard.
        } catch (error) {
            console.error(`Error clearing existing events for source '${targetHostName}':`, error);
            client.close();
            return;
        }
    } else {
        console.log('Clearing ALL existing events from the database...');
        try {
            await db.delete(schema.events);
            console.log(' -> Existing events cleared successfully.');
        } catch (error) {
            console.error('Error clearing existing events:', error);
            client.close(); // Close connection if clearing fails
            return;
        }
    }
    // --- End Clear existing data ---


    console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

    // Prepare data for insertion, mapping ScrapedEvent to the schema format
    const eventsToInsert: schema.InsertEvent[] = allEvents.map(event => ({
        name: event.name,
        startAt: event.startAt,
        endAt: event.endAt,
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

    Deno.writeTextFileSync('events.json', JSON.stringify(eventsToInsert, null, 2));

    try {
        let successCount = 0;

        // Insert events one by one instead of in bulk
        for (const event of eventsToInsert) {
            try {
                // Use insert with onConflictDoUpdate to handle potential duplicate permalinks
                await db.insert(schema.events)
                    .values(event)
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
        client.close();
        console.log('Database connection closed.');
    }

    console.log('--- Germany Event Scraper Finished ---');
}

if (import.meta.main) {
    main().catch(error => {
        console.error("Unhandled error in main execution:", error);
        Deno.exit(1);
    });
} 