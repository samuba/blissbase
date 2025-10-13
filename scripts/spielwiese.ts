import 'dotenv/config';
import { db, s } from '../src/lib/server/db';
import { eq } from 'drizzle-orm';
import { allTags } from '../src/lib/tags';
import { slugify } from '../src/lib/common';


await db.delete(s.tags);
await db.delete(s.tagTranslations);

console.log("Inserting tags...");

const BATCH_SIZE = 20;

for (let i = 0; i < allTags.length; i += BATCH_SIZE) {
    const batch = allTags.slice(i, i + BATCH_SIZE);

    // Insert tags in parallel, collect their slugs and original tag info
    const tagInsertPromises = batch.map(tag =>
        db.insert(s.tags)
            .values({ slug: slugify(tag.en) })
            .returning()
            .onConflictDoNothing()
            .then(res => ({ res, tag }))
    );
    const insertedTags = await Promise.all(tagInsertPromises);

    // Prepare tag translations for all inserted tags that returned an id
    const translationsToInsert = [] as any[];
    for (const { res, tag } of insertedTags) {
        // If no rows returned due to onConflictDoNothing, skip this tag
        if (!res[0] || !res[0].id) continue;
        const id = res[0].id;
        translationsToInsert.push(
            { tagId: id, locale: 'en', name: tag.en },
            { tagId: id, locale: 'de', name: tag.de },
            { tagId: id, locale: 'nl', name: tag.nl }
        );
    }

    // Insert all translations for this batch in a single query if any need inserting
    if (translationsToInsert.length > 0) {
        await db.insert(s.tagTranslations).values(translationsToInsert);
    }

    process.stdout.write(".");
}

console.log("\nDone inserting tags.");

process.exit(0);