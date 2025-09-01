import { alias } from 'drizzle-orm/pg-core';
import {
    db, s, sql, and, lt, eq, isNotNull, gte
} from '../src/lib/server/db';
import { WEBSITE_SCRAPE_SOURCES, WebsiteScrapeSource } from './common';

const duplicates = await getPotentialDuplicates(0.5);

let deletedCount = 0;
for (const dup of duplicates) {
    let idToDelete = 0;
    console.log('Found duplicate:', dup);

    if (dup.source_a === dup.source_b && WEBSITE_SCRAPE_SOURCES.includes(dup.source_a as WebsiteScrapeSource)) {
        console.log(`Skipping this one cuz both are from ${dup.source_a} website. Unlikely to be real duplicate.`);
        continue
    }

    // Define website priority
    const websiteSourcePriority: string[] = ([
        'seijetzt',
        'tribehaus',
        'awara',
        'kuschelraum',
        'heilnetz',
        'heilnetzowl',
        'ggbrandenburg',
    ] satisfies WebsiteScrapeSource[]).reverse();

    if (websiteSourcePriority.includes(dup.source_a) || websiteSourcePriority.includes(dup.source_b)) {
        // one of the sources is a website
        const priorityA = websiteSourcePriority.indexOf(dup.source_a);
        const priorityB = websiteSourcePriority.indexOf(dup.source_b);
        if (priorityA > priorityB) {
            console.log(`Deleting event B cuz ${dup.source_a} is better source than ${dup.source_b}`, dup.id_b);
            idToDelete = dup.id_b;
        } else if (priorityB > priorityA) {
            console.log(`Deleting event A cuz ${dup.source_b} is better source than ${dup.source_a}`, dup.id_a);
            idToDelete = dup.id_a;
        }
    } else {
        // none of the sources are websites -> longest description wins
        idToDelete = dup.desc_a.length >= dup.desc_b.length ? dup.id_a : dup.id_b
    }

    if (idToDelete) {
        const event = await db.query.events.findFirst({ where: eq(s.events.id, idToDelete) })
        if (event) {
            console.log(`Deleting event ${event.slug} (${event.id}) from ${event.source}`, event.description);
            await db.delete(s.events).where(eq(s.events.id, idToDelete));
            deletedCount++;
        } else {
            console.warn(`Event to be deleted not found!`, idToDelete);
        }
    }
}

console.log("found", duplicates.length, "potential duplicates. ")
console.log("Deleted", deletedCount, "duplicates. Ignored", duplicates.length - deletedCount, "duplicates.");

async function getPotentialDuplicates(descriptionSimilarityThreshold) {
    const event_b = alias(s.events, 'b');
    const description_coal = sql<string>`coalesce(${s.events.description}, '')`;
    // const slug_coal = sql`coalesce(${s.events.slug}, '')`;
    const event_b_description_coal = sql<string>`coalesce(${event_b.description}, '')`;
    // const event_b_slug_coal = sql`coalesce(${event_b.slug}, '')`;
    // const slug_similarity = sql<number>`similarity(${slug_coal}, ${event_b_slug_coal}) * 0.5`; // nerf slug, cuz its not as important as description
    const desc_similarity = sql<number>`similarity(${description_coal}, ${event_b_description_coal})`//.as('desc_similarity');
    return db
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
}

process.exit(0);

