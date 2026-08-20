import { db, s, sql, and, eq } from '../src/lib/server/db.script.ts';
import { legacyTagsToSlugs, unmatchedLegacyTags } from '../src/lib/legacyTagsToSlugs.ts';

const applyFlag = `--apply`;
const batchSize = 200;

const emptyTagSlugs = sql`COALESCE(cardinality(${s.events.tagSlugs}), 0) = 0`;
const hasLegacyTags = sql`${s.events.tags} IS NOT NULL AND COALESCE(cardinality(${s.events.tags}), 0) > 0`;

/**
 * Fills empty `tag_slugs` from legacy `events.tags` labels. Dry-run unless `--apply`.
 *
 * @example
 * bun run scripts/backfill-tag-slugs-from-tags.ts
 * bun run scripts/backfill-tag-slugs-from-tags.ts --apply
 * bun run scripts/backfill-tag-slugs-from-tags.ts --limit=50
 */
async function backfillTagSlugsFromTags(args: { apply: boolean; limit: number | null }) {
	const mode = args.apply ? `apply` : `dry run`;
	console.log(`Backfilling empty tag_slugs from events.tags (${mode})`);

	const eventsQuery = db
		.select({
			id: s.events.id,
			name: s.events.name,
			tags: s.events.tags,
		})
		.from(s.events)
		.where(and(emptyTagSlugs, hasLegacyTags));
	const events = args.limit === null ? await eventsQuery : await eventsQuery.limit(args.limit);

	console.log(`Found ${events.length} events with empty tag_slugs and legacy tags`);
	if (!events.length) return;

	const unmatchedCounts = new Map<string, number>();
	const toUpdate: { id: number; name: string; tags: string[]; tagSlugs: string[] }[] = [];
	let skippedNoMatch = 0;
	let failed = 0;

	for (const event of events) {
		try {
			const tags = event.tags ?? [];
			const tagSlugs = legacyTagsToSlugs(tags);
			for (const tag of unmatchedLegacyTags(tags)) {
				unmatchedCounts.set(tag, (unmatchedCounts.get(tag) ?? 0) + 1);
			}
			if (!tagSlugs.length) {
				skippedNoMatch += 1;
				continue;
			}
			toUpdate.push({
				id: event.id,
				name: event.name,
				tags,
				tagSlugs,
			});
		} catch (error) {
			failed += 1;
			console.error(`Failed mapping event ${event.id}:`, error);
		}
	}

	printUnmatchedHistogram(unmatchedCounts);
	printSample(toUpdate);

	console.log(`Mapped ${toUpdate.length} events to catalog slugs`);
	console.log(`Skipped ${skippedNoMatch} events (no catalog slug matched)`);
	if (failed) console.log(`Failed to map ${failed} events`);

	if (!args.apply) {
		console.log(`Dry run only. Re-run with ${applyFlag} to write tag_slugs.`);
		return;
	}

	let updated = 0;
	for (const batch of chunk(toUpdate, batchSize)) {
		try {
			updated += await applyBatch(batch);
		} catch (error) {
			failed += 1;
			console.error(`Failed updating batch starting at event ${batch[0]?.id}:`, error);
			for (const row of batch) {
				try {
					updated += await applyRow(row);
				} catch (rowError) {
					console.error(`Failed updating event ${row.id}:`, rowError);
				}
			}
		}
	}

	const [{ count: stillEmpty }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(s.events)
		.where(emptyTagSlugs);

	console.log(`Updated ${updated} events`);
	console.log(`${stillEmpty} events still have empty tag_slugs`);
}

async function applyBatch(rows: { id: number; tagSlugs: string[] }[]) {
	if (!rows.length) return 0;

	const values = rows.map((row) => {
		const slugsSql = sql`ARRAY[${sql.join(row.tagSlugs.map((slug) => sql`${slug}`), sql`, `)}]::text[]`;
		return sql`(${row.id}::int, ${slugsSql})`;
	});

	const updated = await db.execute<{ id: number }>(sql`
		UPDATE ${s.events} AS e
		SET tag_slugs = v.slugs
		FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, slugs)
		WHERE e.id = v.id
			AND COALESCE(cardinality(e.tag_slugs), 0) = 0
		RETURNING e.id
	`);

	return updated.length;
}

async function applyRow(row: { id: number; tagSlugs: string[] }) {
	const updated = await db
		.update(s.events)
		.set({ tagSlugs: row.tagSlugs })
		.where(and(eq(s.events.id, row.id), emptyTagSlugs))
		.returning({ id: s.events.id });
	return updated.length;
}

function printUnmatchedHistogram(counts: Map<string, number>) {
	if (!counts.size) {
		console.log(`No unmatched legacy tags`);
		return;
	}

	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	console.log(`Unmatched legacy tags (${ranked.length} distinct):`);
	for (const [tag, count] of ranked) {
		console.log(`  ${count}× ${tag}`);
	}
}

function printSample(rows: { id: number; name: string; tags: string[]; tagSlugs: string[] }[]) {
	if (!rows.length) return;
	console.log(`Sample mappings:`);
	for (const row of rows.slice(0, 10)) {
		console.log(`  ${row.id} ${row.name}: ${row.tags.join(`, `)} → ${row.tagSlugs.join(`, `)}`);
	}
	if (rows.length > 10) console.log(`  ...`);
}

function chunk<T>(items: T[], size: number) {
	const batches: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size));
	}
	return batches;
}

function parseLimit(args: string[]) {
	const limitArg = args.find((arg) => arg.startsWith(`--limit=`));
	if (!limitArg) return null;
	const value = Number(limitArg.slice(`--limit=`.length));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid --limit value`);
	}
	return value;
}

if (import.meta.main) {
	try {
		const cliArgs = process.argv.slice(2);
		if (cliArgs.includes(`--help`) || cliArgs.includes(`-h`)) {
			console.log(`Usage: bun run scripts/backfill-tag-slugs-from-tags.ts [--apply] [--limit=N]`);
			process.exit(0);
		}
		await backfillTagSlugsFromTags({
			apply: cliArgs.includes(applyFlag),
			limit: parseLimit(cliArgs),
		});
		process.exit(0);
	} catch (error) {
		console.error(`Failed to backfill tag_slugs from tags:`, error);
		process.exit(1);
	}
}
