import { allTagSlugs, slugsForTagInput } from "../src/lib/eventCategories";
import { slugify } from "../src/lib/common";

const applyFlag = `--apply`;
const batchSize = 200;
const removedTagAliases = new Map([
	[`sound-journey-sound-bath`, [`sound-journey`, `sound-bath`]],
	[`childrens-yoga`, [`yoga`, `childrens-workshop`]],
	[`menopause-transition`, [`menopause`]],
	[`hands-on-energy-healing`, [`hands-on-healing`]],
]);

/**
 * Normalizes every stored tag slug to the current catalog and merges any
 * additional catalog concepts that can still be recovered from legacy tags.
 * Unknown values are intentionally dropped.
 *
 * @example
 * normalizeEventTagSlugs({
 *   tagSlugs: [`relationships`, `sound-journey-sound-bath`],
 *   legacyTags: [`Children's Workshop`],
 * })
 */
export function normalizeEventTagSlugs(args: { tagSlugs?: string[] | null; legacyTags?: string[] | null }) {
	const normalized: string[] = [];
	const seen = new Set<string>();

	for (const input of [...(args.tagSlugs ?? []), ...(args.legacyTags ?? [])]) {
		for (const slug of resolveCatalogSlugs(input)) {
			if (seen.has(slug)) continue;
			seen.add(slug);
			normalized.push(slug);
		}
	}

	return normalized;
}

/**
 * Resolves a canonical slug, stale slug, translated label, synonym, or
 * compound legacy label to current catalog slugs.
 */
export function resolveCatalogSlugs(input: string) {
	const trimmed = input.trim();
	if (!trimmed) return [];

	const resolved: string[] = [];
	const seen = new Set<string>();
	const add = (slugs: string[]) => {
		for (const slug of slugs) {
			if (!allTagSlugs.has(slug) || seen.has(slug)) continue;
			seen.add(slug);
			resolved.push(slug);
		}
	};

	if (allTagSlugs.has(trimmed)) add([trimmed]);
	add(removedTagAliases.get(trimmed) ?? []);
	add(removedTagAliases.get(slugify(trimmed)) ?? []);
	add(slugsForTagInput(trimmed));

	const parts = trimmed
		.split(/\s*(?:,|\/|\bund\b)\s*/i)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length > 1) {
		for (const part of parts) add(slugsForTagInput(part));
	}

	return resolved;
}

/**
 * Normalizes all event tag slugs. Dry-run unless `--apply`.
 *
 * @example
 * bun run scripts/backfill-tag-slugs-from-tags.ts
 * bun run scripts/backfill-tag-slugs-from-tags.ts --apply
 * bun run scripts/backfill-tag-slugs-from-tags.ts --limit=50
 */
async function backfillTagSlugsFromTags(args: { apply: boolean; limit: number | null }) {
	const { db, sql } = await import("../src/lib/server/db.script");
	const mode = args.apply ? `apply` : `dry run`;
	console.log(`Normalizing tag_slugs and merging legacy events.tags (${mode})`);

	const queriedEvents = await db.execute<LegacyEventRow>(sql`
		SELECT
			id,
			name,
			tags,
			tag_slugs AS "tagSlugs"
		FROM events
		ORDER BY id
	`);
	const events = args.limit === null ? queriedEvents : queriedEvents.slice(0, args.limit);
	const unknownStoredCounts = new Map<string, number>();
	const unknownLegacyCounts = new Map<string, number>();
	const toUpdate: NormalizationUpdate[] = [];
	let failed = 0;

	for (const event of events) {
		try {
			const tagSlugs = normalizeEventTagSlugs({
				tagSlugs: event.tagSlugs,
				legacyTags: event.tags,
			});
			countUnknownInputs({
				inputs: event.tagSlugs,
				counts: unknownStoredCounts,
			});
			countUnknownInputs({
				inputs: event.tags,
				counts: unknownLegacyCounts,
			});
			if (arraysEqual(event.tagSlugs, tagSlugs)) continue;

			toUpdate.push({
				id: event.id,
				name: event.name,
				originalTagSlugs: event.tagSlugs,
				tagSlugs,
			});
		} catch (error) {
			failed += 1;
			console.error(`Failed normalizing event ${event.id}:`, error);
		}
	}

	printUnknownHistogram(`Unknown stored tag slugs to drop`, unknownStoredCounts);
	printUnknownHistogram(`Unmapped legacy tags to ignore`, unknownLegacyCounts);
	printSample(toUpdate);

	console.log(`Scanned ${events.length} events`);
	console.log(`${toUpdate.length} events need normalized tag slugs`);
	if (failed) console.log(`Failed to normalize ${failed} events`);

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

	console.log(`Updated ${updated} events`);
	if (updated !== toUpdate.length) {
		console.log(`${toUpdate.length - updated} events were not updated, likely because tag_slugs changed concurrently`);
	}
	console.log(`Re-run without ${applyFlag} and confirm that 0 events need normalization.`);

	async function applyBatch(rows: NormalizationUpdate[]) {
		if (!rows.length) return 0;

		const values = rows.map(
			(row) => sql`(
			${row.id}::int,
			${toTextArraySql(row.originalTagSlugs)},
			${toTextArraySql(row.tagSlugs)}
		)`,
		);
		const result = await db.execute<{ id: number }>(sql`
			UPDATE events AS e
			SET tag_slugs = v.tag_slugs
			FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, original_tag_slugs, tag_slugs)
			WHERE e.id = v.id
				AND e.tag_slugs = v.original_tag_slugs
			RETURNING e.id
		`);
		return result.length;
	}

	async function applyRow(row: NormalizationUpdate) {
		const result = await db.execute<{ id: number }>(sql`
			UPDATE events
			SET tag_slugs = ${toTextArraySql(row.tagSlugs)}
			WHERE id = ${row.id}
				AND tag_slugs = ${toTextArraySql(row.originalTagSlugs)}
			RETURNING id
		`);
		return result.length;
	}

	function toTextArraySql(values: string[]) {
		if (!values.length) return sql`ARRAY[]::text[]`;
		return sql`ARRAY[${sql.join(
			values.map((value) => sql`${value}`),
			sql`, `,
		)}]::text[]`;
	}
}

function countUnknownInputs(args: { inputs?: string[] | null; counts: Map<string, number> }) {
	for (const input of args.inputs ?? []) {
		if (resolveCatalogSlugs(input).length) continue;
		args.counts.set(input, (args.counts.get(input) ?? 0) + 1);
	}
}

function arraysEqual(a: string[], b: string[]) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function printUnknownHistogram(label: string, counts: Map<string, number>) {
	if (!counts.size) {
		console.log(`${label}: none`);
		return;
	}

	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	console.log(`${label} (${ranked.length} distinct):`);
	for (const [tag, count] of ranked) {
		console.log(`  ${count}× ${tag}`);
	}
}

function printSample(rows: NormalizationUpdate[]) {
	if (!rows.length) return;
	console.log(`Sample normalizations:`);
	for (const row of rows.slice(0, 10)) {
		console.log(`  ${row.id} ${row.name}: ${row.originalTagSlugs.join(`, `)} → ${row.tagSlugs.join(`, `)}`);
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
		console.error(`Failed normalizing event tag slugs:`, error);
		process.exit(1);
	}
}

type LegacyEventRow = {
	id: number;
	name: string;
	tags: string[] | null;
	tagSlugs: string[];
};

type NormalizationUpdate = {
	id: number;
	name: string;
	originalTagSlugs: string[];
	tagSlugs: string[];
};
