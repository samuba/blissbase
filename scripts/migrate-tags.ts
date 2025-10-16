import 'dotenv/config';
import { db, s, sql, eq, and, inArray } from '../src/lib/server/db.ts';

/**
 * Migrates tags from events.tags (text array) to event_tags junction table.
 * Matches tag strings with tag_translations where locale='en' to find tag IDs.
 * 
 * Example: 
 * If event has tags=['Yoga', 'Meditation'], this script will:
 * 1. Find the tag IDs by looking up 'Yoga' and 'Meditation' in tag_translations (locale='en')
 * 2. Insert rows into event_tags linking the event to those tag IDs
 */
async function migrateTags() {
    console.log(`Starting tag migration...`);

    // Get all events with tags
    const eventsWithTags = await db
        .select({
            id: s.events.id,
            tags: s.events.tags,
        })
        .from(s.events)
        .where(sql`${s.events.tags} IS NOT NULL AND array_length(${s.events.tags}, 1) > 0`);

    console.log(`Found ${eventsWithTags.length} events with tags`);

    if (!eventsWithTags.length) {
        console.log(`No events with tags found. Migration complete.`);
        return;
    }

    // Collect all unique tag names
    const allTagNames = new Set<string>();
    for (const event of eventsWithTags) {
        if (event.tags?.length) {
            for (const tag of event.tags) {
                allTagNames.add(tag);
            }
        }
    }

    console.log(`Found ${allTagNames.size} unique tag names across all events`);

    // Get all tag translations for locale='en' that match these names
    const tagTranslationsData = await db
        .select({
            tagId: s.tagTranslations.tagId,
            name: s.tagTranslations.name,
        })
        .from(s.tagTranslations)
        .where(
            and(
                eq(s.tagTranslations.locale, `en`),
                inArray(s.tagTranslations.name, Array.from(allTagNames))
            )
        );

    // Create a map of tag name -> tag ID
    const tagNameToId = new Map<string, number>();
    for (const translation of tagTranslationsData) {
        tagNameToId.set(translation.name, translation.tagId);
    }

    console.log(`Found ${tagNameToId.size} matching tags in tag_translations`);

    // Prepare event_tags inserts
    const eventTagsToInsert: { eventId: number; tagId: number }[] = [];
    const missingTags = new Set<string>();

    for (const event of eventsWithTags) {
        if (!event.tags?.length) continue;

        for (const tagName of event.tags) {
            const tagId = tagNameToId.get(tagName);
            if (tagId) {
                eventTagsToInsert.push({
                    eventId: event.id,
                    tagId: tagId,
                });
            } else {
                missingTags.add(tagName);
            }
        }
    }

    if (missingTags.size > 0) {
        console.warn(`Warning: ${missingTags.size} tag names in events.tags were not found in tag_translations:`);
        console.warn(Array.from(missingTags).join(`, `));
    }

    if (!eventTagsToInsert.length) {
        console.log(`No event_tags to insert. Migration complete.`);
        return;
    }

    console.log(`Inserting ${eventTagsToInsert.length} event_tags entries...`);

    // Insert in batches to avoid overwhelming the database
    const batchSize = 1000;
    let insertedCount = 0;

    for (let i = 0; i < eventTagsToInsert.length; i += batchSize) {
        const batch = eventTagsToInsert.slice(i, i + batchSize);
        await db
            .insert(s.eventTags)
            .values(batch)
            .onConflictDoNothing(); // Skip if already exists (eventId, tagId is primary key)

        insertedCount += batch.length;
        console.log(`Inserted ${insertedCount} / ${eventTagsToInsert.length} event_tags...`);
    }

    console.log(`✓ Migration complete! Inserted ${eventTagsToInsert.length} event_tags entries.`);
}

// Run migration
migrateTags()
    .then(() => {
        console.log(`Migration finished successfully`);
        process.exit(0);
    })
    .catch((error) => {
        console.error(`Migration failed:`, error);
        process.exit(1);
    });

