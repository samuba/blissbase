import { alias } from 'drizzle-orm/pg-core';
import {
    db, s, sql, and, lt, eq, isNotNull, gte,
    inArray
} from '../src/lib/server/db';
import { WEBSITE_SCRAPE_SOURCES, WebsiteScrapeSource } from './common';
import { calculateHammingDistance } from '../src/lib/imageProcessing';


const { duplicates, eventsWithSameStart } = await getDuplicateEventsByImageHash(5);
let deletedCount = await processDuplicates(duplicates, eventsWithSameStart);

const textDuplicates = await getDuplicateEventsByTextSimilarity(0.5);
deletedCount += await processDuplicates(textDuplicates, eventsWithSameStart);

console.log(`Found ${duplicates.length + textDuplicates.length} duplicates.`);
console.log(`Based on image hash: ${duplicates.length}, based on text similarity: ${textDuplicates.length}`)
console.log("Deleted", deletedCount, "duplicates. Ignored", (duplicates.length + textDuplicates.length) - deletedCount, "duplicates.");
process.exit(0);

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
        const { events } = group;

        for (let i = 0; i < events.length; i++) {
            const eventA = events[i];
            if (!eventA.imageUrls || !Array.isArray(eventA.imageUrls)) continue;
            for (let j = 0; j < events.length; j++) {
                if (i === j) continue;
                const eventB = events[j];
                if (!eventB.imageUrls || !Array.isArray(eventB.imageUrls)) continue;
                for (const urlA of eventA.imageUrls) {
                    for (const urlB of eventB.imageUrls) {
                        const hashA = getHashFromImageUrl(urlA);
                        const hashB = getHashFromImageUrl(urlB);
                        if (!hashA || !hashB) continue;
                        const dist = calculateHammingDistance(hashA, hashB);
                        if (dist <= hammingDistanceThreshold) {
                            if (duplicates.some(d => d.urlA === urlA && d.urlB === urlB)) continue;
                            duplicates.push({
                                dist,
                                urlA,
                                urlB,
                                eventAId: eventA.id,
                                eventBId: eventB.id
                            });
                        }
                    }
                }
            }
        }
    }

    return { duplicates, eventsWithSameStart: groupedEvents.flatMap(g => g.events) };
}

function getHashFromImageUrl(url: string) {
    return url.split("/").pop()!.split(".")[0];
}


async function processDuplicates(duplicates: { eventAId: number, eventBId: number }[], eventsWithSameStart: typeof s.events.$inferSelect[]) {
    let deletedCount = 0;
    for (const dupe of duplicates) {
        const eventA = eventsWithSameStart.find(e => e.id === dupe.eventAId);
        const eventB = eventsWithSameStart.find(e => e.id === dupe.eventBId);
        if (!eventA || !eventB) throw new Error(`Event not found for id: ${dupe.eventAId} or ${dupe.eventBId}`);

        ({ deletedCount } = await mergeEvents(eventA!, eventB!, deletedCount));
    }
    return deletedCount;
}

/**
 * Merges the two events into one. Will delete one event and take all properties from the deleted event and add it to the surviving event, if these properties were not already set.
 */
async function mergeEvents(eventA: typeof s.events.$inferSelect, eventB: typeof s.events.$inferSelect, deletedCount: number) {
    if (eventA.source === eventB.source && WEBSITE_SCRAPE_SOURCES.includes(eventA.source as WebsiteScrapeSource)) {
        console.log(`Skipping this one cuz both are from ${eventA.source} website. Unlikely to be real duplicate.`);
        return { deletedCount };
    }

    // determine surviving event by website source
    const websiteSourcePriority: string[] = ([
        'seijetzt',
        'tribehaus',
        'awara',
        'kuschelraum',
        'ciglobalcalendar',
        'heilnetz',
        'heilnetzowl',
        'ggbrandenburg',
    ] satisfies WebsiteScrapeSource[]).reverse();
    const priorityA = websiteSourcePriority.indexOf(eventA.source);
    const priorityB = websiteSourcePriority.indexOf(eventB.source);
    if (priorityA > -1 || priorityB > -1) {
        // one of the sources is a website
        const idToDelete = priorityA > priorityB ? eventB.id : eventA.id;
        console.log(`Deleting event ${idToDelete} cuz the other has superior website source`);
        await db.delete(s.events).where(eq(s.events.id, idToDelete));
        return { deletedCount: deletedCount + 1 }; // we exit here cuz when source is a website we assume data is already clean and complete, no reason to merge
    }

    // sources are not websites -> longest description wins, merge other properties
    let eventToDelete = (eventA.description?.length ?? 0) < (eventB.description?.length ?? 0) ? eventA : eventB;
    let eventToSurvive = (eventA.description?.length ?? 0) > (eventB.description?.length ?? 0) ? eventA : eventB;
    if (eventA.description?.length === eventB.description?.length) {
        eventToDelete = eventA
        eventToSurvive = eventB
    }
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
    eventToSurvive.tags = mergeArrayDeduplicated(eventToSurvive.tags, eventToDelete.tags)
    eventToSurvive.telegramRoomIds = mergeArrayDeduplicated(eventToSurvive.telegramRoomIds, eventToDelete.telegramRoomIds)
    if (eventToDelete.imageUrls?.length) {
        // Only add entries to imageUrls that have a hammingDistance of less than 5 to any of the already existing images in the array
        for (const toDelUrl of eventToDelete.imageUrls) {
            const toDelHash = getHashFromImageUrl(toDelUrl);
            if (
                !(eventToSurvive.imageUrls ?? []).some(x => calculateHammingDistance(getHashFromImageUrl(x), toDelHash) <= 5)
            ) {
                if (!eventToSurvive.imageUrls) eventToSurvive.imageUrls = [];
                eventToSurvive.imageUrls.push(toDelUrl);
            }
        }
    }
    if ((eventToDelete.address?.length ?? 0) > (eventToSurvive.address?.length ?? 0)) {
        eventToSurvive.address = eventToDelete.address;
    }
    console.log("Surviving event after merging:", eventToSurvive);
    const { id, ...eventToSurviveWithoutId } = eventToSurvive;
    await db.update(s.events).set(eventToSurviveWithoutId).where(eq(s.events.id, eventToSurvive.id));
    console.log(`Deleting ${eventToDelete.slug} (${eventToDelete.id})`);
    await db.delete(s.events).where(eq(s.events.id, eventToDelete.id));
    return { deletedCount: deletedCount + 1 };
}

function mergeArrayDeduplicated(arrayA: string[] | null, arrayB: string[] | null) {
    return Array.from(new Set([...(arrayA ?? []), ...(arrayB ?? [])]));
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
