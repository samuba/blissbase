/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz, SeiJetzt)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-germany.ts [source] [--clean]
 * 
 * Examples:
 * bun run scripts/scrape-germany.ts                    # Scrape all sources
 * bun run scripts/scrape-germany.ts awara              # Scrape only awara
 * bun run scripts/scrape-germany.ts --clean            # Clear all sources and scrape all
 * bun run scripts/scrape-germany.ts awara --clean      # Clear awara and scrape awara
 * 
 * The '--clean' flag deletes all existing events from the target source(s) before insertion.
 */

import type { InsertEvent, ScrapedEvent } from '../src/lib/types.ts';
import * as schema from '../src/lib/server/schema.ts';
import { AwaraScraper } from './scrape-awara.ts';
import { TribehausScraper } from './scrape-tribehaus.ts';
import { HeilnetzScraper } from './scrape-heilnetz.ts';
import { SeijetztScraper } from './scrape-seijetzt.ts';
import { db } from "../src/lib/server/db.ts";
import { insertEvent } from '../src/lib/server/events.ts';
import { cachedImageUrl } from '../src/lib/common.ts';
import { inArray } from 'drizzle-orm';
import { parseArgs } from 'util';

const SCRAPE_SOURCES = ['awara', 'tribehaus', 'heilnetz', 'seijetzt'];

console.log('--- Starting Germany Event Scraper ---');

// --- Process Arguments ---
const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        clean: {
            type: 'boolean',
            default: false,
        },
    },
    allowPositionals: true,
});

const shouldClean = values.clean;
let targetSourceArg: string | null = null;

// Check if a source is specified as positional argument
if (positionals.length > 0) {
    const sourceArgLower = positionals[0].toLowerCase();
    if (SCRAPE_SOURCES.includes(sourceArgLower)) {
        targetSourceArg = sourceArgLower;
        console.log(`Targeting single source for scraping: ${targetSourceArg}`);
    } else {
        console.warn(`Invalid source argument: ${positionals[0]}. Valid sources are: ${SCRAPE_SOURCES.join(', ')}. Scraping all sources.`);
    }
}

if (!targetSourceArg) {
    console.log('No specific source specified, scraping all sources.');
}

if (shouldClean) {
    console.log('Clean flag detected - will delete existing events from target sources before insertion.');
}

let allEvents: ScrapedEvent[] = [];

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

console.log(`--- Total events scraped this run: ${allEvents.length} ---`);

if (allEvents.length === 0) {
    console.log('No events to process. Exiting.');
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
    process.exit(1); // Stop if we can't confirm table existence
}

// --- Clear existing events if requested ---
if (shouldClean) {
    console.log('Clearing existing events from target sources...');

    let sourcesToClear: string[] = [];

    if (targetSourceArg) {
        // Clear only the target source
        sourcesToClear = [targetSourceArg];
    } else {
        // Clear all scrape sources
        sourcesToClear = SCRAPE_SOURCES;
    }

    console.log(` -> Deleting events from sources: ${sourcesToClear.join(', ')}`);

    try {
        await db.delete(schema.events)
            .where(inArray(schema.events.source, sourcesToClear));

        console.log(` -> Successfully cleared existing events from ${sourcesToClear.length} source(s)`);
    } catch (error) {
        console.error('Error clearing existing events:', error);
        throw error;
    }
}

/**
 * Removes "sold out" suffixes from event names and detects if event is sold out
 * Handles German and English terms: ausgebucht, ausverkauft, voll, sold out, etc.
 * Case insensitive and handles various separators (whitespace, -, |, etc.)
 * @returns Object with cleaned name and soldOut boolean
 */
function cleanEventNameAndDetectSoldOut(name: string): { cleanedName: string; soldOut: boolean } {
    if (!name) return { cleanedName: name, soldOut: false };

    // List of sold-out indicators in German and English
    const soldOutTerms = [
        'ausgebucht',
        'ausverkauft',
        'voll',
        'sold out',
        'vollbesetzt',
        'komplett ausgebucht',
        'restlos ausverkauft'
    ];

    // Create regex pattern that matches any of the terms with various separators
    // Pattern explanation:
    // [\s\-\u2010-\u2015\|\(\)\[\]]+  = one or more whitespace, various dashes, pipe, parentheses, or brackets
    // (?:term1|term2|...)  = non-capturing group with sold-out terms
    // [\s\-\u2010-\u2015\|\(\)\[\]]*$  = optional separators at the end
    // \u2010-\u2015 covers: hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar
    const pattern = new RegExp(
        `[\\s\\-\\u2010-\\u2015\\|\\(\\)\\[\\]]+(?:${soldOutTerms.join('|')})[\\s\\-\\u2010-\\u2015\\|\\(\\)\\[\\]]*$`,
        'gi'
    );

    const cleanedName = name.replace(pattern, '').trim();
    const soldOut = cleanedName !== name; // If the name changed, sold-out text was found

    return { cleanedName, soldOut };
}

console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

// Prepare data for insertion, mapping ScrapedEvent to the schema format
const eventsToInsert = allEvents.map(x => {
    const { cleanedName, soldOut } = cleanEventNameAndDetectSoldOut(x.name);
    return {
        ...x,
        name: cleanedName,
        soldOut,
        slug: "", // will be generated later
        startAt: typeof x.startAt === 'string' ? new Date(x.startAt) : x.startAt,
        endAt: typeof x.endAt === 'string' ? new Date(x.endAt) : x.endAt,
        imageUrls: x.imageUrls?.filter(x => x).map(x => cachedImageUrl(x)!),
        description: x.description?.replace(/<br>(\s*<br>){2,}/g, '<br><br>') // Limit consecutive <br> tags to maximum 2, regardless of whitespace between them

    } satisfies InsertEvent;
});

// Pre-warm image URLs by making HEAD requests to ensure they're cached
console.log('Pre-warming image URLs...');
const uniqueImageUrls = [...new Set(eventsToInsert.flatMap(e => e.imageUrls ?? []))];
console.log(` -> Found ${uniqueImageUrls.length} unique image URLs to warm`);
const batchSize = 15;
for (let i = 0; i < uniqueImageUrls.length; i += batchSize) {
    const batch = uniqueImageUrls.slice(i, i + batchSize);
    await Promise.all(batch.map(url =>
        fetch(url).catch(() => console.warn(` -> Failed to warm URL: ${url}`))
    ));
    console.log(` -> Warmed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueImageUrls.length / batchSize)}`);
}
console.log(' -> Finished warming image URLs');


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

