import { alias } from 'drizzle-orm/pg-core';
import {
    db, s, sql, and, lt, eq, isNotNull, gte,
    inArray
} from '../src/lib/server/db.script.ts';
import { deduplicateItems } from '../src/lib/common';
import { WEBSITE_SCRAPE_SOURCES, WebsiteScrapeSourceName } from '../src/lib/commonWithScripts';
import { calculateHammingDistance } from '../src/lib/imageProcessing';
import { getProcessedImageHashFromUrl } from '../src/lib/imageUpload.shared';
import type { SelectEvent } from '../src/lib/server/schema';
import { FORM_CREATED_EVENT_SOURCE, normalizeSourceUrl } from '../src/lib/server/events.shared';

export async function main() {
    const { duplicates, eventsWithSameStart } = await getDuplicateEventsByImageHash(5);
    let deletedCount = await processDuplicates({
        duplicates,
        eventsWithSameStart,
        mergeDuplicateEvents: mergeEvents,
    });

    const textDuplicates = await getDuplicateEventsByTextSimilarity(0.5);
    deletedCount += await processDuplicates({
        duplicates: textDuplicates,
        eventsWithSameStart,
        mergeDuplicateEvents: mergeEvents,
    });

    console.log(`Found ${duplicates.length + textDuplicates.length} duplicates.`);
    console.log(`Based on image hash: ${duplicates.length}, based on text similarity: ${textDuplicates.length}`)
    console.log("Deleted", deletedCount, "duplicates. Ignored", (duplicates.length + textDuplicates.length) - deletedCount, "duplicates.");
    process.exit(0);
}

if (import.meta.main) {
    await main();
}

async function getDuplicateEventsByImageHash(hammingDistanceThreshold: number) {
    const duplicates: {
        dist: number,
        urlA: string,
        urlB: string
        eventAId: number,
        eventBId: number,
    }[] = [];

    const groupedEvents = await getEventsGroupedByStartAtWithDuplicates();
    for (const group of groupedEvents) {
        duplicates.push(...findImageHashDuplicatePairs({
            events: group.events,
            hammingDistanceThreshold,
        }));
    }

    return { duplicates, eventsWithSameStart: groupedEvents.flatMap(g => g.events) };
}

/**
 * Compares image hashes within one startAt group. Invalid hashes are logged and skipped.
 *
 * @example
 * findImageHashDuplicatePairs({
 *   events: [{ id: 1, imageUrls: [`https://assets.blissbase.app/events/a/abc123def45.webp`] }],
 *   hammingDistanceThreshold: 5,
 * });
 */
export function findImageHashDuplicatePairs(args: {
    events: { id: number, imageUrls: string[] | null }[],
    hammingDistanceThreshold: number,
}) {
    const duplicates: {
        dist: number,
        urlA: string,
        urlB: string
        eventAId: number,
        eventBId: number,
    }[] = [];
    const warnedInvalidImageUrls = new Set<string>();
    const { events, hammingDistanceThreshold } = args;

    for (let i = 0; i < events.length; i++) {
        const eventA = events[i];
        if (!eventA.imageUrls?.length) continue;
        for (let j = 0; j < events.length; j++) {
            if (i === j) continue;
            const eventB = events[j];
            if (!eventB.imageUrls?.length) continue;
            for (const urlA of eventA.imageUrls) {
                for (const urlB of eventB.imageUrls) {
                    const hashA = getHashFromImageUrl(urlA);
                    const hashB = getHashFromImageUrl(urlB);
                    if (!hashA) warnInvalidImageHash({ url: urlA, eventId: eventA.id, warnedInvalidImageUrls });
                    if (!hashB) warnInvalidImageHash({ url: urlB, eventId: eventB.id, warnedInvalidImageUrls });
                    if (!hashA || !hashB) continue;
                    const dist = safeHammingDistance({
                        hashA,
                        hashB,
                        urlA,
                        urlB,
                        eventAId: eventA.id,
                        eventBId: eventB.id,
                    });
                    if (dist === undefined) continue;
                    if (dist > hammingDistanceThreshold) continue;
                    if (duplicates.some(d => d.urlA === urlA && d.urlB === urlB)) continue;
                    duplicates.push({
                        dist,
                        urlA,
                        urlB,
                        eventAId: eventA.id,
                        eventBId: eventB.id,
                    });
                }
            }
        }
    }

    return duplicates;
}

function getHashFromImageUrl(url: string) {
    return getProcessedImageHashFromUrl({ url });
}

function warnInvalidImageHash(args: {
    url: string,
    eventId: number,
    warnedInvalidImageUrls: Set<string>,
}) {
    if (args.warnedInvalidImageUrls.has(args.url)) return;
    args.warnedInvalidImageUrls.add(args.url);
    console.warn(`Skipping invalid image hash for event ${args.eventId}: ${args.url}`);
}

function safeHammingDistance(args: {
    hashA: string,
    hashB: string,
    urlA: string,
    urlB: string,
    eventAId: number,
    eventBId: number,
}) {
    try {
        return calculateHammingDistance(args.hashA, args.hashB);
    } catch (error) {
        console.warn(
            `Skipping invalid image hash pair for event ${args.eventAId} image ${args.urlA} vs event ${args.eventBId} image ${args.urlB}: ${args.hashA} vs ${args.hashB}`,
            {
                urlA: args.urlA,
                urlB: args.urlB,
                error,
            },
        );
        return undefined;
    }
}


/**
 * Merges the two events into one. Will delete one event and take all properties from the deleted event and add it to the surviving event, if these properties were not already set.
 */
async function mergeEvents(args: {
    eventA: SelectEvent,
    eventB: SelectEvent,
    deletedCount: number,
}) {
    const { eventA, eventB, deletedCount } = args;
    const formCreatedPlan = getFormCreatedDeduplicationPlan({ eventA, eventB });
    if (formCreatedPlan.action === `skip`) {
        console.log(`Skipping duplicate pair cuz both events were created on Blissbase via form.`);
        return { deletedCount };
    }
    if (formCreatedPlan.action === `merge`) {
        return await mergeAndDeleteDuplicateEvents({
            eventToSurvive: formCreatedPlan.eventToSurvive,
            eventToDelete: formCreatedPlan.eventToDelete,
            deletedCount,
        });
    }

    if (eventA.source === eventB.source && WEBSITE_SCRAPE_SOURCES.includes(eventA.source as WebsiteScrapeSourceName)) {
        console.log(`Skipping this one cuz both are from ${eventA.source} website. Unlikely to be real duplicate.`);
        return { deletedCount };
    }

    // determine surviving event by website source
    const websiteSourcePriority: string[] = ([
        'seijetzt',
        'tribehaus',
        'kuschelraum',
        'ciglobalcalendar',
        'heilnetz',
        'heilnetzowl',
        'ggbrandenburg',
    ] satisfies WebsiteScrapeSourceName[]).reverse();
    const priorityA = websiteSourcePriority.indexOf(eventA.source);
    const priorityB = websiteSourcePriority.indexOf(eventB.source);
    if (priorityA > -1 || priorityB > -1) {
        // one of the sources is a website
        const eventToSurvive = priorityA > priorityB ? eventA : eventB;
        const eventToDelete = priorityA > priorityB ? eventB : eventA;
        const survivingEventUpdate = preparePreferredSourceEventUpdate({
            eventToSurvive,
            eventToDelete,
        });
        console.log(`Deleting event ${eventToDelete.id} cuz the other has superior website source`);
        await db.transaction(async (tx) => {
            await tx.update(s.events).set(survivingEventUpdate).where(eq(s.events.id, eventToSurvive.id));
            await tx.delete(s.events).where(eq(s.events.id, eventToDelete.id));
        });
        return {
            deletedCount: deletedCount + 1,
            survivingEvent: eventToSurvive,
            deletedEventId: eventToDelete.id,
        }; // we exit here cuz when source is a website we assume data is already clean and complete, no reason to merge
    }

    // sources are not websites -> longest description wins, merge other properties
    let eventToDelete = (eventA.description?.length ?? 0) < (eventB.description?.length ?? 0) ? eventA : eventB;
    let eventToSurvive = (eventA.description?.length ?? 0) > (eventB.description?.length ?? 0) ? eventA : eventB;
    if (eventA.description?.length === eventB.description?.length) {
        eventToDelete = eventA
        eventToSurvive = eventB
    }
    return await mergeAndDeleteDuplicateEvents({
        eventToSurvive,
        eventToDelete,
        deletedCount,
    });
}

async function mergeAndDeleteDuplicateEvents(args: {
    eventToSurvive: SelectEvent,
    eventToDelete: SelectEvent,
    deletedCount: number,
}) {
    const { eventToSurvive, eventToDelete, deletedCount } = args;
    console.log(`Merging ${eventToSurvive.slug} with ${eventToDelete.slug} (will be deleted)`);

    console.log("Survivng event before merging:", eventToSurvive);
    // take useful values from event that will be deleted 
    for (const key of Object.keys(eventToSurvive)) {
        if (
            Object.prototype.hasOwnProperty.call(eventToDelete, key) &&
            Object.prototype.hasOwnProperty.call(eventToSurvive, key) &&
            !eventToSurvive[key] &&
            eventToDelete[key]
        ) {
            eventToSurvive[key] = eventToDelete[key];
            console.log(`Setting ${key} to ${eventToSurvive[key]}`, {
                longDesc: eventToSurvive.slug,
                shortDesc: eventToDelete.slug,
            });
        }
    }
    // merge array properties
    eventToSurvive.tagSlugs = mergeArrayDeduplicated(eventToSurvive.tagSlugs, eventToDelete.tagSlugs)
    eventToSurvive.sourceChatIdsTelegram = mergeArrayDeduplicated(eventToSurvive.sourceChatIdsTelegram, eventToDelete.sourceChatIdsTelegram)
    eventToSurvive.sourceChatIdsWhatsapp = mergeArrayDeduplicated(eventToSurvive.sourceChatIdsWhatsapp, eventToDelete.sourceChatIdsWhatsapp)
    if (eventToDelete.imageUrls?.length) {
        // Keep extra images unless they already look like one on the survivor
        for (const toDelUrl of eventToDelete.imageUrls) {
            const toDelHash = getHashFromImageUrl(toDelUrl);
            if (
                !(eventToSurvive.imageUrls ?? []).some((x) => {
                    const survivingHash = getHashFromImageUrl(x);
                    if (!survivingHash || !toDelHash) return false;
                    const dist = safeHammingDistance({
                        hashA: survivingHash,
                        hashB: toDelHash,
                        urlA: x,
                        urlB: toDelUrl,
                        eventAId: eventToSurvive.id,
                        eventBId: eventToDelete.id,
                    });
                    return dist !== undefined && dist <= 5;
                })
            ) {
                if (!eventToSurvive.imageUrls) eventToSurvive.imageUrls = [];
                eventToSurvive.imageUrls.push(toDelUrl);
            }
        }
    }
    if ((eventToDelete.address?.length ?? 0) > (eventToSurvive.address?.length ?? 0)) {
        eventToSurvive.address = eventToDelete.address;
    }
    eventToSurvive.sourceUrl = getMergedSourceUrl({
        survivingSourceUrl: eventToSurvive.sourceUrl,
        deletedSourceUrl: eventToDelete.sourceUrl,
    });
    eventToSurvive.imageUrls = deduplicateItems(eventToSurvive.imageUrls);
    console.log("Surviving event after merging:", eventToSurvive);
    const { id: _id, ...eventToSurviveWithoutId } = eventToSurvive;
    await db.transaction(async (tx) => {
        await tx.update(s.events).set(eventToSurviveWithoutId).where(eq(s.events.id, eventToSurvive.id));
        console.log(`Deleting ${eventToDelete.slug} (${eventToDelete.id})`);
        await tx.delete(s.events).where(eq(s.events.id, eventToDelete.id));
    });
    return {
        deletedCount: deletedCount + 1,
        survivingEvent: eventToSurvive,
        deletedEventId: eventToDelete.id,
    };
}

/**
 * Chooses the Blissbase form-created event as the survivor, or skips if both are protected.
 *
 * @example
 * getFormCreatedDeduplicationPlan({ eventA: { source: `website-form` }, eventB: { source: `telegram` } })
 */
export function getFormCreatedDeduplicationPlan<TEvent extends { source: string }>(args: {
    eventA: TEvent,
    eventB: TEvent,
}): FormCreatedDeduplicationPlan<TEvent> {
    const eventAIsFormCreated = args.eventA.source === FORM_CREATED_EVENT_SOURCE;
    const eventBIsFormCreated = args.eventB.source === FORM_CREATED_EVENT_SOURCE;

    if (eventAIsFormCreated && eventBIsFormCreated) return { action: `skip` };
    if (eventAIsFormCreated) {
        return {
            action: `merge`,
            eventToSurvive: args.eventA,
            eventToDelete: args.eventB,
        };
    }
    if (eventBIsFormCreated) {
        return {
            action: `merge`,
            eventToSurvive: args.eventB,
            eventToDelete: args.eventA,
        };
    }

    return { action: `none` };
}

/**
 * Keeps a valid survivor source URL, otherwise falls back to a valid deleted-event URL.
 *
 * @example
 * getMergedSourceUrl({ survivingSourceUrl: `https://blissbase.app/demo`, deletedSourceUrl: `https://example.com/demo` })
 */
export function getMergedSourceUrl(args: {
    survivingSourceUrl: string | null,
    deletedSourceUrl: string | null,
}) {
    const survivingSourceUrl = normalizeSourceUrl(args.survivingSourceUrl);
    if (survivingSourceUrl) return survivingSourceUrl;
    return normalizeSourceUrl(args.deletedSourceUrl);
}

/**
 * Returns all events grouped by startAt, only including groups with more than one event.
 * Each group is an object: { startAt: Date, events: Event[] }
 */
async function getEventsGroupedByStartAtWithDuplicates() {
    // Get all events, grouped by startAt, where there is more than one event per startAt
    // 1. Find all startAt values with more than one event
    const duplicateStartAts = await db
        .select({ startAt: s.events.startAt })
        .from(s.events)
        .groupBy(s.events.startAt)
        .having(sql`count(*) > 1`);

    if (!duplicateStartAts.length) return [];

    // 2. For each duplicate startAt, fetch all events with that startAt
    const startAtValues = duplicateStartAts.map(row => row.startAt);

    // Fetch all events with those startAt values
    const events = await db
        .select()
        .from(s.events)
        .where(inArray(s.events.startAt, startAtValues));

    // Group events by startAt
    const grouped: Record<string, typeof events> = {};
    for (const event of events) {
        const key = event.startAt instanceof Date ? event.startAt.toISOString() : String(event.startAt);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
    }

    // Return as array of { startAt, events }
    return Object.entries(grouped).map(([startAt, events]) => ({
        startAt,
        events
    }));
}

async function getDuplicateEventsByTextSimilarity(descriptionSimilarityThreshold): Promise<Awaited<ReturnType<typeof getDuplicateEventsByImageHash>>['duplicates']> {
    const event_b = alias(s.events, 'b');
    const description_coal = sql<string>`coalesce(${s.events.description}, '')`;
    // const slug_coal = sql`coalesce(${s.events.slug}, '')`;
    const event_b_description_coal = sql<string>`coalesce(${event_b.description}, '')`;
    // const event_b_slug_coal = sql`coalesce(${event_b.slug}, '')`;
    // const slug_similarity = sql<number>`similarity(${slug_coal}, ${event_b_slug_coal}) * 0.5`; // nerf slug, cuz its not as important as description
    const desc_similarity = sql<number>`similarity(${description_coal}, ${event_b_description_coal})`//.as('desc_similarity');
    const duplicates = await db
        .select({
            id_a: s.events.id,
            url_a: sql`'https://blissbase.app/' || ${s.events.slug}`,
            desc_a: description_coal,
            source_a: s.events.source,

            id_b: event_b.id,
            url_b: sql`'https://blissbase.app/' || ${event_b.slug}`,
            desc_b: event_b_description_coal,
            source_b: event_b.source,

            desc_similarity: desc_similarity.as('desc_similarity'),
            // slug_similarity,
            // total_similarity: sql<number>`${desc_similarity} + ${slug_similarity}`.as('total_similarity')
        })
        .from(s.events)
        .innerJoin(event_b,
            and(
                lt(s.events.id, event_b.id),
                eq(s.events.startAt, event_b.startAt)
            )
        )
        .where(
            and(
                isNotNull(s.events.description),
                isNotNull(event_b.description),
                gte(desc_similarity, descriptionSimilarityThreshold),
            )
        )
        .orderBy(
            sql`desc_similarity DESC`
        );

    return duplicates.map(dup => ({
        dist: Number(dup.desc_similarity),
        urlA: String(dup.url_a),
        urlB: String(dup.url_b),
        eventAId: Number(dup.id_a),
        eventBId: Number(dup.id_b),
    }));
}

/**
 * Processes duplicate pairs against a live in-memory event map so later pairs
 * cannot accidentally reuse rows that were already deleted in an earlier merge.
 *
 * @example
 * await processDuplicates({
 *   duplicates: [{ eventAId: 1, eventBId: 2 }],
 *   eventsWithSameStart: [{ id: 1 }, { id: 2 }],
 *   mergeDuplicateEvents: async ({ deletedCount, eventB }) => ({
 *     deletedCount: deletedCount + 1,
 *     survivingEvent: eventB,
 *     deletedEventId: 1,
 *   }),
 * });
 */
export async function processDuplicates<TEvent extends { id: number }>(args: {
    duplicates: DuplicatePair[],
    eventsWithSameStart: TEvent[],
    mergeDuplicateEvents: MergeDuplicateEvents<TEvent>,
}) {
    const activeEventsById = new Map(args.eventsWithSameStart.map((event) => [event.id, event]));
    let deletedCount = 0;

    for (const dupe of args.duplicates) {
        const eventA = activeEventsById.get(dupe.eventAId);
        const eventB = activeEventsById.get(dupe.eventBId);

        if (!eventA || !eventB) {
            console.warn(`Event not found for id: ${dupe.eventAId} or ${dupe.eventBId}`);
            continue;
        }

        const mergeResult = await args.mergeDuplicateEvents({ eventA, eventB, deletedCount });
        deletedCount = mergeResult.deletedCount;

        if (mergeResult.deletedEventId) {
            activeEventsById.delete(mergeResult.deletedEventId);
        }

        if (mergeResult.survivingEvent) {
            activeEventsById.set(mergeResult.survivingEvent.id, mergeResult.survivingEvent);
        }
    }

    return deletedCount;
}

export function mergeArrayDeduplicated(arrayA: string[] | null, arrayB: string[] | null) {
    return Array.from(new Set([...(arrayA ?? []), ...(arrayB ?? [])]));
}

/**
 * Builds the update payload for the preferred-source fast path while keeping
 * catalog tags and chat provenance in sync with the deleted event.
 *
 * @example
 * preparePreferredSourceEventUpdate({
 *   eventToSurvive: { tagSlugs: [`yoga`], sourceChatIdsTelegram: null, sourceChatIdsWhatsapp: null },
 *   eventToDelete: { tagSlugs: [`meditation`], sourceChatIdsTelegram: [`room1`], sourceChatIdsWhatsapp: null },
 * });
 */
export function preparePreferredSourceEventUpdate<TEvent extends {
    tagSlugs: string[] | null
    sourceChatIdsTelegram: string[] | null
    sourceChatIdsWhatsapp: string[] | null
}>(args: {
    eventToSurvive: TEvent,
    eventToDelete: TEvent,
}) {
    args.eventToSurvive.tagSlugs = mergeArrayDeduplicated(args.eventToSurvive.tagSlugs, args.eventToDelete.tagSlugs);
    args.eventToSurvive.sourceChatIdsTelegram = mergeArrayDeduplicated(
        args.eventToSurvive.sourceChatIdsTelegram,
        args.eventToDelete.sourceChatIdsTelegram,
    );
    args.eventToSurvive.sourceChatIdsWhatsapp = mergeArrayDeduplicated(
        args.eventToSurvive.sourceChatIdsWhatsapp,
        args.eventToDelete.sourceChatIdsWhatsapp,
    );

    return {
        tagSlugs: args.eventToSurvive.tagSlugs,
        sourceChatIdsTelegram: args.eventToSurvive.sourceChatIdsTelegram,
        sourceChatIdsWhatsapp: args.eventToSurvive.sourceChatIdsWhatsapp,
    };
}

type DuplicatePair = {
    eventAId: number,
    eventBId: number,
};

type MergeDuplicateEvents<TEvent extends { id: number }> = (
    args: MergeDuplicateEventsArgs<TEvent>,
) => Promise<MergeDuplicateEventsResult<TEvent>>;

type MergeDuplicateEventsArgs<TEvent extends { id: number }> = {
    eventA: TEvent,
    eventB: TEvent,
    deletedCount: number,
};

type MergeDuplicateEventsResult<TEvent extends { id: number }> = {
    deletedCount: number,
    survivingEvent?: TEvent,
    deletedEventId?: number,
};

type FormCreatedDeduplicationPlan<TEvent> =
    | { action: `none` }
    | { action: `skip` }
    | {
        action: `merge`,
        eventToSurvive: TEvent,
        eventToDelete: TEvent,
    };
