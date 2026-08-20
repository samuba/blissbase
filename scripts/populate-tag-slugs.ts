import { db, s, sql } from '../src/lib/server/db.script.ts';

const emptyTagSlugs = sql`COALESCE(cardinality(${s.events.tagSlugs}), 0) = 0`;

/**
 * Copies tag slugs from event_tags/tags onto events that still have an empty tag_slugs array.
 *
 * @example
 * bun run scripts/populate-tag-slugs.ts
 */
async function populateTagSlugs() {
	console.log(`Populating empty tag_slugs from event_tags...`);

	const [{ count: emptyCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(s.events)
		.where(emptyTagSlugs);

	console.log(`Found ${emptyCount} events with empty tag_slugs`);
	if (!emptyCount) return;

	const updated = await db
		.update(s.events)
		.set({
			tagSlugs: sql`(
				SELECT array_agg(${s.tags.slug} ORDER BY ${s.tags.slug})
				FROM ${s.eventTags}
				INNER JOIN ${s.tags} ON ${s.tags.id} = ${s.eventTags.tagId}
				WHERE ${s.eventTags.eventId} = ${s.events.id}
			)`,
		})
		.where(sql`${emptyTagSlugs} AND EXISTS (
			SELECT 1 FROM ${s.eventTags} WHERE ${s.eventTags.eventId} = ${s.events.id}
		)`)
		.returning({
			id: s.events.id,
			name: s.events.name,
			tagSlugs: s.events.tagSlugs,
		});

	console.log(`Updated ${updated.length} events`);
	for (const event of updated.slice(0, 10)) {
		console.log(`  ${event.id} ${event.name}: ${event.tagSlugs.join(`, `)}`);
	}
	if (updated.length > 10) console.log(`  ...`);

	const [{ count: stillEmpty }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(s.events)
		.where(emptyTagSlugs);

	if (stillEmpty) {
		console.log(`${stillEmpty} events still have empty tag_slugs (no event_tags rows)`);
	}
}

if (import.meta.main) {
	try {
		await populateTagSlugs();
		process.exit(0);
	} catch (error) {
		console.error(`Failed to populate tag_slugs:`, error);
		process.exit(1);
	}
}
