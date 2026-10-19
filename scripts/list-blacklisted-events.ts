/**
 * Read-only: list scraped events whose names match blacklist keywords.
 * Does not delete or update anything — Samuel runs purges himself.
 *
 * Usage:
 *   bun run scripts/list-blacklisted-events.ts
 *   bun run scripts/list-blacklisted-events.ts --source heilnetz
 *   bun run scripts/list-blacklisted-events.ts --source heilnetzowl
 */
import { db, s, eq } from '../src/lib/server/db.script.ts';
import { matchesBlackListWords } from '../src/whitelistWords.ts';

export async function main(args: { source?: string }) {
	const query = db
		.select({
			id: s.events.id,
			name: s.events.name,
			source: s.events.source,
			listed: s.events.listed,
			slug: s.events.slug,
			startAt: s.events.startAt,
			sourceUrl: s.events.sourceUrl,
		})
		.from(s.events);

	const rows = args.source ?
		await query.where(eq(s.events.source, args.source)) :
		await query;

	const matches = rows.filter((row) => matchesBlackListWords(row.name));

	console.log(`Scanned ${rows.length} events${args.source ? ` (source=${args.source})` : ``}.`);
	console.log(`Matched blacklist: ${matches.length}`);
	console.log(``);

	for (const row of matches) {
		console.log(
			`#${row.id} listed=${row.listed} source=${row.source} start=${row.startAt.toISOString()} slug=${row.slug}`,
		);
		console.log(`  ${row.name}`);
		if (row.sourceUrl) console.log(`  ${row.sourceUrl}`);
	}

	if (!matches.length) return;

	const ids = matches.map((row) => row.id);
	console.log(``);
	console.log(`Suggested purge (run manually — this script does not execute it):`);
	console.log(`DELETE FROM events WHERE id IN (${ids.join(`, `)});`);
}

if (import.meta.main) {
	try {
		const cliArgs = process.argv.slice(2);
		const sourceFlagIndex = cliArgs.indexOf(`--source`);
		const source =
			sourceFlagIndex >= 0 && cliArgs[sourceFlagIndex + 1] ?
				cliArgs[sourceFlagIndex + 1] :
				undefined;
		await main({ source });
		process.exit(0);
	} catch (error) {
		console.error(`Failed to list blacklisted events:`, error);
		process.exit(1);
	}
}
