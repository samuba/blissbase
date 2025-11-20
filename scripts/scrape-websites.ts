/**
 * Main script to orchestrate scraping from multiple sources (Awara, Tribehaus, Heilnetz, SeiJetzt, ...)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-websites.ts [source] [--clean]
 * 
 * Examples:
 * bun run scripts/scrape-websites.ts                    # Scrape all sources
 * bun run scripts/scrape-websites.ts awara              # Scrape only awara
 * bun run scripts/scrape-websites.ts --clean            # Clear all sources and scrape all
 * bun run scripts/scrape-websites.ts awara --clean      # Clear awara and scrape awara
 * 
 * The '--clean' flag deletes all existing events from the target source(s) before insertion.
 */

import type { InsertEvent, ScrapedEvent } from '../src/lib/types.ts';
import { db, s } from "../src/lib/server/db.ts";
import { insertEvents } from '../src/lib/server/events.ts';
import { generateSlug } from '../src/lib/common.ts';
import { and, inArray, notInArray } from 'drizzle-orm';
import { parseArgs } from 'util';
import { cleanProseHtml, customFetch } from './common.ts';
import { toCalendarDate, fromDate, getLocalTimeZone } from '@internationalized/date';
import { WEBSITE_SCRAPER_CONFIG, WEBSITE_SCRAPE_SOURCES } from './common.ts';
import * as assets from '../src/lib/assets.ts';
import { resizeCoverImage } from '../src/lib/imageProcessing.ts';

/**
 * Dynamically scrapes a single source using its corresponding scraper
 * @param source - The source name to scrape
 * @returns Promise resolving to scraped events
 */
async function scrapeSource(source: string): Promise<ScrapedEvent[]> {
    console.log(`Scraping ${source}...`);

    try {
        const config = WEBSITE_SCRAPER_CONFIG[source as keyof typeof WEBSITE_SCRAPER_CONFIG];
        if (!config) {
            throw new Error(`Unknown source: ${source}`);
        }

        const ScraperClass = (await import(config.module)).WebsiteScraper;
        if (!ScraperClass) {
            throw new Error(`WebsiteScraper class not found in ${config.module}`);
        }
        const events = await new ScraperClass().scrapeWebsite();
        console.log(` -> Found ${events.length} events in ${source}`);

        if (events.length === 0) {
            throw new Error(`No ${source} events found`);
        }

        return events;
    } catch (error) {
        console.error(`Error scraping ${source}:`, error);
        throw error;
    }
}

async function main() {
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
        const sourceArgLower = positionals[0].toLowerCase() as keyof typeof WEBSITE_SCRAPER_CONFIG;
        if (WEBSITE_SCRAPE_SOURCES.includes(sourceArgLower)) {
            targetSourceArg = sourceArgLower;
            console.log(`Targeting single source for scraping: ${targetSourceArg}`);
        } else {
            console.warn(`Invalid source argument: ${positionals[0]}. Valid sources are: ${WEBSITE_SCRAPE_SOURCES.join(', ')}. Scraping all sources.`);
        }
    }

    if (!targetSourceArg) {
        console.log('No specific source specified, scraping all sources.');
    }

    if (shouldClean) {
        console.log('Clean flag detected - will delete existing events from target sources before insertion.');
    }

    // --- Determine sources to scrape ---
    const sourcesToScrape = targetSourceArg ? [targetSourceArg] : WEBSITE_SCRAPE_SOURCES;

    // --- Run Scrapers in Parallel ---
    const scrapePromises = sourcesToScrape.map(source => scrapeSource(source));

    // Wait for all scrapers to complete
    const results = await Promise.all(scrapePromises);
    const allEvents = results.flat();

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
        await db.select({ id: s.events.id }).from(s.events).limit(1);
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
            sourcesToClear = WEBSITE_SCRAPE_SOURCES;
        }

        console.log(` -> Deleting events from sources: ${sourcesToClear.join(', ')}`);

        try {
            await db.delete(s.events).where(inArray(s.events.source, sourcesToClear));

            console.log(` -> Successfully cleared existing events from ${sourcesToClear.length} source(s)`);
        } catch (error) {
            console.error('Error clearing existing events:', error);
            throw error;
        }
    }

    console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

    // Prepare data for insertion, mapping ScrapedEvent to the schema format
    let eventsToInsert = allEvents.map(x => {
        const { cleanedName, soldOut } = cleanEventNameAndDetectSoldOut(x.name);
        return {
            ...x,
            name: cleanedName,
            soldOut,
            slug: generateSlug({ name: cleanedName, startAt: new Date(x.startAt), endAt: x.endAt ? new Date(x.endAt) : undefined }),
            startAt: new Date(x.startAt),
            endAt: x.endAt ? new Date(x.endAt) : undefined,
            imageUrls: x.imageUrls?.filter(x => x),
            description: cleanProseHtml(x.description),
            listed: shouldBeListed({ name: cleanedName }),
            tags: [...new Set(x.tags)] // ensure tags are unique
        } satisfies InsertEvent;
    });

    // remove events that span more than 2 months. These are usually spammy events with people posting their courses, no real "events"
    eventsToInsert = eventsToInsert.filter(e => {
        if (!e.endAt) return true;
        const startAt = toCalendarDate(fromDate(e.startAt, getLocalTimeZone()));
        const endAt = toCalendarDate(fromDate(e.endAt, getLocalTimeZone()));
        const diffDays = endAt.compare(startAt);
        return diffDays <= 60;
    });
    eventsToInsert = deduplicateEvents(eventsToInsert);

    // delete all events that are not in sources and are in the future. So that would be events that were deleted by the organizer
    const deletedEvents = await db.delete(s.events)
        .where(and(
            inArray(s.events.source, sourcesToScrape),
            notInArray(s.events.slug, eventsToInsert.map(e => e.slug)),
            // gte(s.events.startAt, new Date())
        )).returning();
    console.log("Deleted these events cuz they are not in the current scrape anymore:", deletedEvents.map(e => [e.slug, e.sourceUrl]));

    // image processing
    await cacheImages(eventsToInsert);

    // await Bun.write('events.json', JSON.stringify(eventsToInsert, null, 2));

    // await preWarmImageUrls(eventsToInsert);

    let successCount = 0;
    const batchSize = 15;
    for (let i = 0; i < eventsToInsert.length; i += batchSize) {
        const batch = eventsToInsert.slice(i, i + batchSize);

        console.log("batch", batch)

        try {
            await insertEvents(batch);
            successCount += batch.length;

            console.log(` -> Progress: ${successCount}/${eventsToInsert.length} events processed`);
        } catch (error) {
            console.error(`Error inserting batch starting at index ${i}:`, error);
            throw error;
        }
    }

    console.log(` -> Successfully inserted/updated ${successCount} out of ${eventsToInsert.length} events.`);
    console.log('--- Germany Event Scraper Finished ---');
    process.exit(0);
    ///
    ///
    /// End of main function
    ///
    ///



    async function cacheImages(events: typeof eventsToInsert) {
        console.log('Starting image caching...');
        const startTime = Date.now();
        const alreadyCachedImages = await db.select().from(s.imageCacheMap)
        const totalImageCount = events.reduce((sum, event) => sum + (event.imageUrls?.length ?? 0), 0);
        let processedImageCount = 0;
        console.log(` -> Total images to process: ${totalImageCount}`);

        for (const event of events) {
            const cachedEventImageUrls: string[] = []
            const newlyCachedImages: { originalUrl: string, eventSlug: string, url: string }[] = []
            for (const url of event.imageUrls ?? []) {
                if (processedImageCount % 50 === 0) {
                    const elapsedTime = Date.now() - startTime;
                    console.log(` -> Progress: ${processedImageCount}/${totalImageCount} images processed (${(elapsedTime / 1000).toFixed(1)}s elapsed)`);
                }
                const cachedImage = alreadyCachedImages.find(x => x.originalUrl === url && x.eventSlug === event.slug)
                if (cachedImage) {
                    cachedEventImageUrls.push(cachedImage.url);
                    processedImageCount++;
                    continue;
                }
                console.log(` -> Image ${url} not found in image cache map`);
                const bytes = await customFetch(url, { returnType: 'bytes' })
                try {
                    const { buffer, phash } = await resizeCoverImage(bytes)
                    const imageUrl = await assets.uploadImage(buffer, event.slug, phash, assets.loadCreds());
                    cachedEventImageUrls.push(imageUrl);
                    newlyCachedImages.push({ originalUrl: url, eventSlug: event.slug, url: imageUrl });
                    // warm up the image url
                    await customFetch(imageUrl, { returnType: 'bytes' });
                } catch (error) {
                    console.error(`Error processing image. Skipping this one ${url}:`, error);
                }
                processedImageCount++;
            }
            event.imageUrls = cachedEventImageUrls;
            if (newlyCachedImages.length > 0) {
                await db.insert(s.imageCacheMap)
                    .values(newlyCachedImages)
                    .onConflictDoNothing();
            }
        }

        const totalTime = Date.now() - startTime;
        console.log(` -> Image caching completed: ${processedImageCount} images processed in ${(totalTime / 1000).toFixed(1)}s`);
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

    async function preWarmImageUrls(events: typeof eventsToInsert) {
        // Pre-warm image URLs by making HEAD requests to ensure they're cached
        console.log('Pre-warming image URLs...');
        const uniqueImageUrls = [...new Set(events.flatMap(e => e.imageUrls ?? []))];
        console.log(` -> Found ${uniqueImageUrls.length} unique image URLs to warm`);
        const batchSize = 15;
        for (let i = 0; i < uniqueImageUrls.length; i += batchSize) {
            const batch = uniqueImageUrls.slice(i, i + batchSize);
            await Promise.all(batch.map(url =>
                fetch(url)
                    .then(res => res.ok ? res.text() : Promise.reject(res.headers.get('x-cld-error')))
            ));
            console.log(` -> Warmed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueImageUrls.length / batchSize)}`);
        }
        console.log(' -> Finished warming image URLs');
    }

    function deduplicateEvents(events: typeof eventsToInsert) {
        // log all events where slug is not unique in the array and deduplicate
        const slugCounts = new Map<string, number>();
        events.forEach(event => {
            const count = slugCounts.get(event.slug) || 0;
            slugCounts.set(event.slug, count + 1);
        });
        const duplicateSlugs = Array.from(slugCounts.entries())
            .filter(([, count]) => count > 1)
            .map(([slug, count]) => ({ slug, count }));

        if (duplicateSlugs.length > 0) {
            console.warn(`Found ${duplicateSlugs.length} duplicate slugs:`);
            duplicateSlugs.forEach(({ slug, count }) => {
                console.warn(` -> "${slug}" appears ${count} times`);
                const duplicateEvents = events.filter(e => e.slug === slug);
                duplicateEvents.forEach((event, index) => {
                    console.warn(`    ${index + 1}. ${event.sourceUrl}`);
                });
            });

            // Deduplicate by keeping only the last occurrence of each slug
            const uniqueEvents = new Map<string, typeof eventsToInsert[number]>();
            events.forEach(event => {
                uniqueEvents.set(event.slug, event);
            });
            const deduplicatedEvents = Array.from(uniqueEvents.values());
            console.warn(`Deduplicated events. Reduced from ${events.length} to ${deduplicatedEvents.length} events`);
            return deduplicatedEvents;
        } else {
            console.log('All event slugs are unique');
            return events;
        }
    }

    function shouldBeListed({ name }: { name: string }): boolean {
        // yoga classes are too boring to list
        const nameBlacklist = [
            'hatha yoga',
            'hatha-yoga',
            'yin yoga',
            'yin-yoga',
            'yoga im ',
            'yoga für ',
        ];
        return nameBlacklist.every(x => !name.toLowerCase().includes(x));
    }
}
await main();


