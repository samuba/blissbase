/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-germany.ts
 * bun run scripts/scrape-germany.ts awara
 */

import { eq } from 'drizzle-orm'; // Import eq from drizzle-orm directly
import type { ScrapedEvent } from '../src/lib/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { AwaraScraper } from './scrape-awara.ts';
import { TribehausScraper } from './scrape-tribehaus.ts';
import { HeilnetzScraper } from './scrape-heilnetz.ts';
import { SeijetztScraper } from './scrape-seijetzt.ts';
import { db, insertEvent } from "../src/lib/server/db.ts";

const SOURCE_HOSTS = ['awara', 'tribehaus', 'heilnetz', 'seijetzt'];

console.log('--- Starting Germany Event Scraper ---');

// --- Process Arguments ---
const args = process.argv.slice(2);
let targetSourceArg: string | null = null;
let jsonFilePath: string | null = null;

if (args.length > 0) {
    if (args[0].toLowerCase().endsWith('.json')) {
        jsonFilePath = args[0];
        console.log(`Attempting to load events from JSON file: ${jsonFilePath}`);
        if (args.length > 1) {
            const sourceArgLower = args[1].toLowerCase();
            if (SOURCE_HOSTS.includes(sourceArgLower)) {
                targetSourceArg = sourceArgLower;
                console.log(`Targeting source: '${targetSourceArg}' for JSON event filtering and DB clearing.`);
            } else {
                console.warn(`Warning: Invalid source argument '${args[1]}' provided with JSON file. It will be ignored for filtering. Valid sources: ${SOURCE_HOSTS.join(', ')}. If clearing by source from JSON, ensure the source name is valid.`);
            }
        }
    } else {
        const sourceArgLower = args[0].toLowerCase();
        if (SOURCE_HOSTS.includes(sourceArgLower)) {
            targetSourceArg = sourceArgLower;
            console.log(`Targeting single source for scraping: ${targetSourceArg}`);
        } else {
            console.warn(`Invalid source argument: ${args[0]}. Valid sources are: ${SOURCE_HOSTS.join(', ')}. Scraping all sources.`);
        }
    }
}

if (!jsonFilePath && !targetSourceArg && args.length === 0) {
    console.log('No source or JSON file specified, scraping all sources.');
} else if (jsonFilePath && !targetSourceArg && args.length === 1) {
    console.log(`Processing all events from ${jsonFilePath}. DB clearing will target hosts found in the JSON.`);
}

let allEvents: ScrapedEvent[] = [];

if (jsonFilePath) {
    try {
        const fileContent = await Bun.file(jsonFilePath).text();
        const loadedEvents = JSON.parse(fileContent) as ScrapedEvent[];
        console.log(`Successfully loaded ${loadedEvents.length} events from ${jsonFilePath}`);

        if (targetSourceArg) {
            const originalCount = loadedEvents.length;
            allEvents = loadedEvents.filter(event => event.host === targetSourceArg);
            console.log(`Filtered events to host '${targetSourceArg}', ${allEvents.length} of ${originalCount} events remain.`);
            if (allEvents.length === 0 && originalCount > 0) {
                console.warn(`Warning: No events matched the target source '${targetSourceArg}' from the JSON file.`);
            }
        } else {
            allEvents = loadedEvents;
        }
    } catch (error) {
        console.error(`Error reading or parsing JSON file ${jsonFilePath}:`, error);
        process.exit(1);
    }
} else {
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

    console.log(`--- Total events ${jsonFilePath ? 'loaded from JSON' : 'scraped this run'}: ${allEvents.length} ---`);

    if (allEvents.length === 0) {
        console.log(`No events to process${jsonFilePath ? ' after filtering (if any)' : ''}. Exiting.`);
        process.exit(0);
    }
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
    process.exit(1); // Stop if we can't confirm table existence
}

// --- Clear existing data (conditionally) ---
if (jsonFilePath) {
    if (targetSourceArg) {
        // JSON file provided, and a specific targetSourceArg for that JSON's events
        console.log(`Clearing existing events from source '${targetSourceArg}' (specified with JSON input)...`);
        try {
            const re = await db.delete(schema.events).where(eq(schema.events.host, targetSourceArg));
            console.log(` -> ${re.rowCount} existing events for host '${targetSourceArg}' cleared.`);
        } catch (error) {
            console.error(`Error clearing existing events for source '${targetSourceArg}':`, error);
            process.exit(1);
        }
    } else {
        // JSON file provided, but no specific targetSourceArg; clear all hosts found in the JSON
        const hostsInJson = [...new Set(allEvents.map(event => event.host).filter((host): host is string => typeof host === 'string'))];
        if (hostsInJson.length > 0) {
            console.log(`Clearing existing events for hosts found in JSON: ${hostsInJson.join(', ')}...`);
            for (const host of hostsInJson) {
                console.log(`Attempting to clear events for host '${host}'...`);
                try {
                    const re = await db.delete(schema.events).where(eq(schema.events.host, host));
                    console.log(` -> ${re.rowCount} existing events for host '${host}' cleared.`);
                } catch (error) {
                    console.error(`Error clearing existing events for source '${host}':`, error);
                    // Optionally, decide whether to exit or continue. For now, log and continue.
                }
            }
        } else {
            console.log("No valid hosts found in the JSON data to clear, or no events loaded/remained after filtering.");
        }
    }
} else if (targetSourceArg) {
    // Original logic: No JSON file, but a specific targetSourceArg for scraping
    console.log(`Clearing existing events from source '${targetSourceArg}'...`);
    try {
        const re = await db.delete(schema.events).where(eq(schema.events.host, targetSourceArg));
        console.log(` -> ${re.rowCount} existing events for host '${targetSourceArg}' cleared `);
    } catch (error) {
        console.error(`Error clearing existing events for source '${targetSourceArg}':`, error);
        process.exit(1);
    }
} else {
    // Original logic: No JSON file, no targetSourceArg - clear all
    console.log('Clearing ALL existing events from the database...');
    try {
        await db.delete(schema.events);
        console.log(' -> Existing events cleared successfully.');
    } catch (error) {
        console.error('Error clearing existing events:', error);
        process.exit(1);
    }
}
// --- End Clear existing data ---

console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

// Prepare data for insertion, mapping ScrapedEvent to the schema format
const eventsToInsert = allEvents.map(event => ({
    ...event,
    // Convert date strings to Date objects if they're not already
    startAt: typeof event.startAt === 'string' ? new Date(event.startAt) : event.startAt,
    endAt: typeof event.endAt === 'string' ? new Date(event.endAt) : event.endAt,
    // scrapedAt is handled by default value in schema
}));

await Bun.write('events.json', JSON.stringify(eventsToInsert, null, 2));

try {
    let successCount = 0;

    // Insert events one by one instead of in bulk
    for (const event of eventsToInsert) {
        try {
            event.tags = [...new Set(event.tags)] // Ensure tags are unique

            await insertEvent(event);

            successCount++;

            // Log progress every 10 events
            if (successCount % 10 === 0) {
                console.log(` -> Progress: ${successCount}/${eventsToInsert.length} events processed`);
            }
        } catch (error) {
            console.error(`Error inserting event "${event.name}":`, error);
            throw error;
        }
    }

    console.log(` -> Successfully inserted/updated ${successCount} out of ${eventsToInsert.length} events.`);

} catch (error) {
    console.error('Error in event insertion process:', error);
} finally {
    console.log('Database connection closed.');
}

console.log('--- Germany Event Scraper Finished ---');

