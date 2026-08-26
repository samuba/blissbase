/**
 * Main script to orchestrate scraping from multiple sources (Tribehaus, Heilnetz, SeiJetzt, ...)
 * and store the results in a postgres database using Drizzle ORM.
 *
 * Requires Bun, for network requests and file system operations.
 * Usage: 
 * bun run scripts/scrape-websites.ts [source] [--clean] [--exclude source,...] [--log-dir dir]
 * 
 * Examples:
 * bun run scripts/scrape-websites.ts                    # Scrape all sources
 * bun run scripts/scrape-websites.ts tribehaus              # Scrape only tribehaus
 * bun run scripts/scrape-websites.ts --clean            # Clear all sources and scrape all
 * bun run scripts/scrape-websites.ts tribehaus --clean      # Clear tribehaus and scrape tribehaus
 * bun run scripts/scrape-websites.ts --exclude yogabarn # Scrape all except yogabarn
 * 
 * The '--clean' flag deletes existing events from sources that scraped successfully this run.
 * The '--exclude' flag skips one or more sources (comma-separated, repeatable).
 * Per-source console output is teed to scrape-logs/<source>.log (override with --log-dir).
 */

import type { InsertEvent, ScrapedEvent } from '../src/lib/types.ts';
import { db, s, upsertEvents } from '../src/lib/server/db.script.ts';
import { generateSlug } from '../src/lib/common.ts';
import { fillMissingEventTagSlugs } from './tagScrapedEvents.ts';
import { and, inArray, notInArray } from 'drizzle-orm';
import { format } from 'util';
import { AsyncLocalStorage } from 'async_hooks';
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'fs';
import { join } from 'path';
import { cleanProseHtml, customFetch } from './common.ts';
import { toCalendarDate, fromDate, getLocalTimeZone } from '@internationalized/date';
import { WEBSITE_SCRAPER_CONFIG, WebsiteScrapeSourceName } from '../src/lib/commonWithScripts.ts';
import { resolveWebsiteScrapePlan } from './website-scrape-plan.ts';
import * as assets from '../src/lib/assets.ts';
import { resizeCoverImage } from '../src/lib/imageProcessing.ts';
import { matchesBlackListWords, matchesWhiteListWords, whiteListSources } from '../src/whitelistWords.ts';

const scrapeLogContext = new AsyncLocalStorage<WriteStream>();
let consolePatchedForScrapeLogs = false;

/** Tees console output to the active per-source log file while keeping stdout/stderr as-is. */
function patchConsoleForScrapeLogs() {
    if (consolePatchedForScrapeLogs) return;
    consolePatchedForScrapeLogs = true;

    for (const method of [`log`, `info`, `warn`, `error`, `debug`] as const) {
        const original = console[method].bind(console);
        console[method] = (...args: unknown[]) => {
            original(...args);
            const stream = scrapeLogContext.getStore();
            if (!stream) return;
            stream.write(`${format(...args)}\n`);
        };
    }
}

async function endWriteStream(stream: WriteStream) {
    await new Promise<void>((resolve, reject) => {
        stream.end((error) => error ? reject(error) : resolve());
    });
}

/**
 * Dynamically scrapes a single source using its corresponding scraper.
 * Console output is teed into `{logDir}/{source}.log` for CI step dumps.
 */
function writeSourceStatus({ logDir, source, ok }: { logDir: string; source: string; ok: boolean }) {
    writeFileSync(join(logDir, `${source}.status`), ok ? `ok\n` : `fail\n`);
}

async function scrapeSource({ source, logDir }: { source: string; logDir: string }): Promise<ScrapedEvent[]> {
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${source}.log`);
    const stream = createWriteStream(logPath, { flags: `w` });
    stream.write(`=== ${source} @ ${new Date().toISOString()} ===\n`);

    try {
        const events = await scrapeLogContext.run(stream, async () => {
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
                const scraped = await new ScraperClass().scrapeWebsite();
                console.log(` -> Found ${scraped.length} events in ${source}`);

                if (scraped.length === 0 && source !== `vortexapp`) {
                    throw new Error(`No ${source} events found`);
                }

                return scraped;
            } catch (error) {
                console.error(`Error scraping ${source}:`, error);
                throw error;
            }
        });
        writeSourceStatus({ logDir, source, ok: true });
        return events;
    } catch (error) {
        writeSourceStatus({ logDir, source, ok: false });
        throw error;
    } finally {
        await endWriteStream(stream);
    }
}

async function main() {
    console.log('--- Starting Website Event Scraper ---');
    patchConsoleForScrapeLogs();

    const { sources: sourcesToScrape, shouldClean, logDir, targetSource, excludedSources } = resolveWebsiteScrapePlan(process.argv.slice(2));

    if (excludedSources.length > 0) {
        console.log(`Excluding sources: ${excludedSources.join(`, `)}`);
    }

    if (targetSource) {
        console.log(`Targeting single source for scraping: ${targetSource}`);
    } else {
        console.log('No specific source specified, scraping all sources.');
    }

    if (shouldClean) {
        console.log('Clean flag detected - will delete existing events from target sources before insertion.');
    }

    console.log(`Per-source logs: ${logDir}/<source>.log`);

    if (!sourcesToScrape.length) {
        console.error(`No sources left to scrape after applying --exclude.`);
        process.exit(1);
    }

    // --- Run Scrapers in Parallel ---
    const scrapePromises = sourcesToScrape.map(source => scrapeSource({ source, logDir }));

    // Wait for all scrapers to complete (using allSettled to not fail on first error)
    const results = await Promise.allSettled(scrapePromises);
    
    // Separate successful results from failures
    const failedSources: { source: string; error: unknown }[] = [];
    const successfulSources: string[] = [];
    const allEvents: ScrapedEvent[] = [];
    
    results.forEach((result, index) => {
        const source = sourcesToScrape[index];
        if (result.status === 'fulfilled') {
            successfulSources.push(source);
            allEvents.push(...result.value);
        } else {
            failedSources.push({ source, error: result.reason });
            console.error(`Source "${source}" failed:`, result.reason);
        }
    });

    console.log(`--- Total events scraped this run: ${allEvents.length} ---`);
    
    if (failedSources.length > 0) {
        console.warn(`--- ${failedSources.length} source(s) failed: ${failedSources.map(f => f.source).join(', ')} ---`);
    }

    if (allEvents.length === 0) {
        console.log('No events to process. Exiting.');
        process.exit(1);
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
        if (!successfulSources.length) {
            console.log(`Skipping --clean because no sources scraped successfully.`);
        } else {
            console.log(`Clearing existing events from successfully scraped sources...`);
            console.log(` -> Deleting events from sources: ${successfulSources.join(`, `)}`);

            try {
                await db.delete(s.events).where(inArray(s.events.source, successfulSources));

                console.log(` -> Successfully cleared existing events from ${successfulSources.length} source(s)`);
            } catch (error) {
                console.error('Error clearing existing events:', error);
                throw error;
            }
        }
    }

    console.log(`Inserting/Updating ${allEvents.length} events into the database...`);

    // Prepare data for insertion, mapping ScrapedEvent to the schema format
    let eventsToInsert = allEvents.map(x => {
        const { cleanedName, soldOut } = cleanEventNameAndDetectSoldOut(x.name);
        const { tags, ...scraped } = x;
        void tags;
        return {
            ...scraped,
            name: cleanedName,
            soldOut,
            slug: generateSlug({ name: cleanedName, startAt: new Date(x.startAt), endAt: x.endAt ? new Date(x.endAt) : undefined }),
            startAt: new Date(x.startAt),
            endAt: x.endAt ? new Date(x.endAt) : undefined,
            imageUrls: x.imageUrls?.filter(x => x),
            description: cleanProseHtml(x.description),
            listed: shouldBeListed({ name: cleanedName, source: x.source }),
            attendanceMode: detectAttendanceModeFromAddress({ address: x.address }),
        } satisfies InsertEvent;
    });

    console.log("eventsToInsert count", eventsToInsert.length);

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
    // Only touch sources that scraped successfully — a failed source must not wipe its existing events.
    if (successfulSources.length > 0) {
        const deletedEvents = await db.delete(s.events)
            .where(and(
                inArray(s.events.source, successfulSources),
                notInArray(s.events.slug, eventsToInsert.map(e => e.slug)),
                // gte(s.events.startAt, new Date())
            )).returning();
        console.log("Deleted these events cuz they are not in the current scrape anymore:", deletedEvents.map(e => [e.slug, e.sourceUrl]));
    } else {
        console.log(`Skipping stale-event delete because no sources scraped successfully.`);
    }

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
            const upserted = await upsertEvents(batch);
            successCount += batch.length;
            try {
                await fillMissingEventTagSlugs({
                    events: upserted,
                    updateTagSlugs: async ({ ids, tagSlugs }) => {
                        await db.update(s.events).set({ tagSlugs }).where(inArray(s.events.id, ids));
                    },
                });
            } catch (error) {
                console.error(`Error tagging batch starting at index ${i}:`, error);
            }

            console.log(` -> Progress: ${successCount}/${eventsToInsert.length} events processed`);
        } catch (error) {
            console.error(`Error inserting batch starting at index ${i}:`, error);
            throw error;
        }
    }

    console.log(` -> Successfully inserted/updated ${successCount} out of ${eventsToInsert.length} events.`);
    console.log('--- Website Event Scraper Finished ---');
    
    // Throw error at the end if any sources failed
    if (failedSources.length > 0) {
        const errorMessages = failedSources.map(f => `  - ${f.source}: ${f.error instanceof Error ? f.error.message : String(f.error)}`).join('\n');
        throw new Error(`Scraping completed but ${failedSources.length} source(s) failed:\n${errorMessages}`);
    }
    
    process.exit(0);
    ///
    ///
    /// End of main function
    ///
    ///



    async function cacheImages(events: typeof eventsToInsert) {
        const IMAGE_CACHE_CONCURRENCY = 5;
        console.log('Starting image caching...');
        const startTime = Date.now();
        const alreadyCachedImages = await db
            .select({
                originalUrl: s.imageCacheMap.originalUrl,
                eventSlug: s.imageCacheMap.eventSlug,
                url: s.imageCacheMap.url,
            })
            .from(s.imageCacheMap);
        console.log("images in imageCacheMap table", alreadyCachedImages.length);

        const cacheByKey = new Map(
            alreadyCachedImages.map((entry) => [`${entry.eventSlug}\0${entry.originalUrl}`, entry.url] as const),
        );
        const assetCreds = assets.loadCreds();
        const totalImageCount = events.reduce((sum, event) => sum + (event.imageUrls?.length ?? 0), 0);
        let processedImageCount = 0;
        console.log(` -> Total images to process: ${totalImageCount} (concurrency ${IMAGE_CACHE_CONCURRENCY})`);

        type CacheJob = {
            event: (typeof events)[number];
            originalUrl: string;
            index: number;
        };

        const jobs: CacheJob[] = [];
        for (const event of events) {
            for (const [index, originalUrl] of (event.imageUrls ?? []).entries()) {
                if (!originalUrl) continue;
                jobs.push({ event, originalUrl, index });
            }
        }

        // slot results back into each event while preserving original order
        const resultsByEvent = new Map<(typeof events)[number], (string | undefined)[]>();
        for (const event of events) {
            resultsByEvent.set(event, Array.from({ length: event.imageUrls?.length ?? 0 }));
        }

        const newlyCachedImages: { originalUrl: string; eventSlug: string; url: string }[] = [];

        async function processJob(job: CacheJob) {
            const eventResults = resultsByEvent.get(job.event);
            if (!eventResults) return;

            const cacheKey = `${job.event.slug}\0${job.originalUrl}`;
            const cachedUrl = cacheByKey.get(cacheKey);
            if (cachedUrl) {
                eventResults[job.index] = cachedUrl;
                processedImageCount++;
                if (processedImageCount % 50 === 0) {
                    const elapsedTime = Date.now() - startTime;
                    console.log(` -> Progress: ${processedImageCount}/${totalImageCount} images processed (${(elapsedTime / 1000).toFixed(1)}s elapsed)`);
                }
                return;
            }

            console.log(` -> Image ${job.originalUrl} not found in image cache map`);
            try {
                const bytes = await customFetch(job.originalUrl, { returnType: 'bytes' });
                const { buffer, phash } = await resizeCoverImage(bytes);
                const imageUrl = await assets.uploadEventImage(buffer, job.event.slug, phash, assetCreds);
                eventResults[job.index] = imageUrl;
                const newCacheEntry = { originalUrl: job.originalUrl, eventSlug: job.event.slug, url: imageUrl };
                newlyCachedImages.push(newCacheEntry);
                cacheByKey.set(cacheKey, imageUrl);
                await customFetch(imageUrl, { returnType: 'bytes' });
            } catch (error) {
                console.error(`Error fetching/processing image. Skipping ${job.originalUrl}:`, error);
            }

            processedImageCount++;
            if (processedImageCount % 50 === 0) {
                const elapsedTime = Date.now() - startTime;
                console.log(` -> Progress: ${processedImageCount}/${totalImageCount} images processed (${(elapsedTime / 1000).toFixed(1)}s elapsed)`);
            }
        }

        for (let i = 0; i < jobs.length; i += IMAGE_CACHE_CONCURRENCY) {
            const batch = jobs.slice(i, i + IMAGE_CACHE_CONCURRENCY);
            await Promise.all(batch.map((job) => processJob(job)));
        }

        for (const event of events) {
            event.imageUrls = (resultsByEvent.get(event) ?? []).filter((url): url is string => Boolean(url));
        }

        if (newlyCachedImages.length > 0) {
            await db.insert(s.imageCacheMap)
                .values(newlyCachedImages)
                .onConflictDoNothing();
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

    function shouldBeListed({ name, source }: { name: string, source: WebsiteScrapeSourceName }): boolean {
        if (matchesBlackListWords(name)) return false;
        if (whiteListSources.includes(source)) return true; // these sources only have conscious events
        return matchesWhiteListWords(name);
    }

    /**
     * Detects event attendance mode from address text.
     * Returns `online` when the address clearly contains virtual meeting hints, otherwise `offline`.
     * Example: detectAttendanceModeFromAddress({ address: ['Zoom Link: https://zoom.us/j/123'] }) // 'online'
     */
    function detectAttendanceModeFromAddress({ address }: { address: string[] | null | undefined }): InsertEvent['attendanceMode'] {
        if (!address?.length) return `offline`;

        const addressText = address.join(` `).toLowerCase().trim();
        if (!addressText) return `offline`;

        const onlineIndicators = [
            `online`,
            `remote`,
            `livestream`,
            `webinar`,
            `zoom`,
            `google meet`,
            `meet.google`,
            `microsoft teams`,
            `teams.microsoft`,
            `jitsi`,
            `discord`,
            `telegram`,
            `via link`,
            'video call'
        ];

        const hasOnlineIndicator = onlineIndicators.some(indicator => addressText.includes(indicator));
        if (hasOnlineIndicator) return `online`;

        const hasUrl = /https?:\/\/\S+/i.test(addressText);
        if (hasUrl) return `online`;

        return `offline`;
    }
}
await main();


