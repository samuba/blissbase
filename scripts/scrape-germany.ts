/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-germany.ts
 * bun run scripts/scrape-germany.ts awara
 */

import type { ScrapedEvent } from '../src/lib/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { AwaraScraper } from './scrape-awara.ts';
import { TribehausScraper } from './scrape-tribehaus.ts';
import { HeilnetzScraper } from './scrape-heilnetz.ts';
import { SeijetztScraper } from './scrape-seijetzt.ts';
import { db } from "../src/lib/server/db.ts";
import { insertEvent } from '../src/lib/server/events.ts';

const SCRAPE_SOURCES = ['awara', 'tribehaus', 'heilnetz', 'seijetzt'];

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
            if (SCRAPE_SOURCES.includes(sourceArgLower)) {
                targetSourceArg = sourceArgLower;
                console.log(`Targeting source: '${targetSourceArg}' for JSON event filtering and DB clearing.`);
            } else {
                console.warn(`Warning: Invalid source argument '${args[1]}' provided with JSON file. It will be ignored for filtering. Valid sources: ${SCRAPE_SOURCES.join(', ')}. If clearing by source from JSON, ensure the source name is valid.`);
            }
        }
    } else {
        const sourceArgLower = args[0].toLowerCase();
        if (SCRAPE_SOURCES.includes(sourceArgLower)) {
            targetSourceArg = sourceArgLower;
            console.log(`Targeting single source for scraping: ${targetSourceArg}`);
        } else {
            console.warn(`Invalid source argument: ${args[0]}. Valid sources are: ${SCRAPE_SOURCES.join(', ')}. Scraping all sources.`);
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
        console.log('Scraping Awara...');
        let awaraEvents: ScrapedEvent[] = [];
        try {
            awaraEvents = await new AwaraScraper().scrapeWebsite();
        } catch (error) {
            console.error('Error scraping Awara:', error);
            throw error;
        }
        console.log(` -> Found ${awaraEvents.length} events.`);
        if (awaraEvents.length === 0) throw new Error('No awara events found');
        allEvents = allEvents.concat(awaraEvents);
    }
    if (!targetSourceArg || targetSourceArg === 'tribehaus') {
        console.log('Scraping Tribehaus...');
        let tribehausEvents: ScrapedEvent[] = [];
        try {
            tribehausEvents = await new TribehausScraper().scrapeWebsite();
        } catch (error) {
            console.error('Error scraping Tribehaus:', error);
            throw error;
        }
        console.log(` -> Found ${tribehausEvents.length} events.`);
        if (tribehausEvents.length === 0) throw new Error('No tribehaus events found');
        allEvents = allEvents.concat(tribehausEvents);
    }

    if (!targetSourceArg || targetSourceArg === 'heilnetz') {
        console.log('Scraping Heilnetz...');
        let heilnetzEvents: ScrapedEvent[] = [];
        try {
            heilnetzEvents = await new HeilnetzScraper().scrapeWebsite();
        } catch (error) {
            console.error('Error scraping Heilnetz:', error);
            throw error;
        }
        console.log(` -> Found ${heilnetzEvents.length} events.`);
        if (heilnetzEvents.length === 0) throw new Error('No heilnetz events found');
        allEvents = allEvents.concat(heilnetzEvents);
    }

    if (!targetSourceArg || targetSourceArg === 'seijetzt') {
        console.log('Scraping SeiJetzt...');
        let seijetztEvents: ScrapedEvent[] = [];
        try {
            seijetztEvents = await new SeijetztScraper().scrapeWebsite();
        } catch (error) {
            console.error('Error scraping SeiJetzt:', error);
            throw error;
        }
        console.log(` -> Found ${seijetztEvents.length} events.`);
        if (seijetztEvents.length === 0) throw new Error('No seijetzt events found');
        allEvents = allEvents.concat(seijetztEvents);
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

console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

// Prepare data for insertion, mapping ScrapedEvent to the schema format
const eventsToInsert = allEvents.map(event => {
    event.startAt = typeof event.startAt === 'string' ? new Date(event.startAt) : event.startAt;
    event.endAt = typeof event.endAt === 'string' ? new Date(event.endAt) : event.endAt;
    return event;
});

await Bun.write('events.json', JSON.stringify(eventsToInsert, null, 2));

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


console.log('--- Germany Event Scraper Finished ---');

