/**
 * Read-only export of already-tagged events for the Jev tagger bake-off.
 * Usage: bun run scripts/jev/exportGoldSet.ts [--out scripts/jev/gold-set.json] [--limit 200]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, s } from "../../src/lib/server/db.script.ts";
import { stripHtml, trimAllWhitespaces } from "../../src/lib/common.ts";
import { GOLD_SET_SIZE } from "./constants.ts";
import { sampleGoldSet, type GoldEvent } from "./goldSet.ts";
import { guessLanguage } from "./languageGuess.ts";

const outFlag = process.argv.includes(`--out`) ? process.argv[process.argv.indexOf(`--out`) + 1] : `scripts/jev/gold-set.json`;
const limitFlag = process.argv.includes(`--limit`) ? Number(process.argv[process.argv.indexOf(`--limit`) + 1]) : GOLD_SET_SIZE;

if (!process.env.DATABASE_URL?.trim()) {
	console.error(`DATABASE_URL is required (read-only select of already-tagged events).`);
	process.exit(1);
}

const rows = await db
	.select({
		id: s.events.id,
		name: s.events.name,
		description: s.events.description,
		tagSlugs: s.events.tagSlugs,
		source: s.events.source,
	})
	.from(s.events)
	.where(sql`array_length(${s.events.tagSlugs}, 1) > 0`)
	.orderBy(s.events.id)
	.limit(4000);

const unique = new Map<string, GoldEvent>();
for (const row of rows) {
	if (!row.tagSlugs?.length) continue;
	const description = trimAllWhitespaces(stripHtml(row.description ?? ``)) ?? ``;
	const key = `${row.name}\0${description}`;
	if (unique.has(key)) continue;
	unique.set(key, {
		id: row.id,
		name: row.name,
		description,
		tagSlugs: row.tagSlugs,
		source: row.source,
		language: guessLanguage({ name: row.name, description, source: row.source }),
	});
}

const gold = sampleGoldSet({ events: [...unique.values()], limit: Number.isFinite(limitFlag) ? limitFlag : GOLD_SET_SIZE });
const outPath = resolve(outFlag);
writeFileSync(outPath, `${JSON.stringify(gold, null, `\t`)}\n`);

const languageCounts = countBy(gold, (event) => event.language);
console.log(`Wrote ${gold.length} gold events to ${outPath}`);
console.log(`Languages:`, languageCounts);

process.exit(0);

function countBy<T>(items: T[], key: (item: T) => string) {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const value = key(item);
		counts[value] = (counts[value] ?? 0) + 1;
	}
	return counts;
}
