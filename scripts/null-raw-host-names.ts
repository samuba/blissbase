import "varlock/auto-load";
import { inArray, isNotNull } from "drizzle-orm";
import { isProperDisplayName } from "../src/lib/displayName";
import { db, s } from "../src/lib/server/db.script.ts";

const confirmFlag = `--confirm`;
const chunkSize = 500;

/**
 * Nulls event host names that are WhatsApp JIDs, phone numbers, or numeric ids.
 * Dry-run unless `--confirm` is passed. Safe to run more than once.
 *
 * @example
 * bun run scripts/null-raw-host-names.ts
 * bun run scripts/null-raw-host-names.ts --confirm
 */
export async function main(args: { confirmed: boolean }) {
	const rows = await db
		.select({
			id: s.events.id,
			slug: s.events.slug,
			host: s.events.host,
		})
		.from(s.events)
		.where(isNotNull(s.events.host));

	const matches = rows.filter((row) => !isProperDisplayName(row.host));
	const action = args.confirmed ? `Cleared` : `Would clear`;

	for (const row of matches) {
		console.log(`${action} host on event ${row.id} (${row.slug}): ${row.host}`);
	}

	if (args.confirmed && matches.length) {
		const ids = matches.map((row) => row.id);
		for (let index = 0; index < ids.length; index += chunkSize) {
			const chunk = ids.slice(index, index + chunkSize);
			await db.update(s.events).set({ host: null }).where(inArray(s.events.id, chunk));
		}
	}

	const summary = args.confirmed
		? `Cleared ${matches.length} raw host names.`
		: `Would clear ${matches.length} raw host names. Re-run with ${confirmFlag} to write.`;
	console.log(``);
	console.log(summary);
}

if (import.meta.main) {
	try {
		await main({ confirmed: process.argv.slice(2).includes(confirmFlag) });
		process.exit(0);
	} catch (error) {
		console.error(`Failed to clear raw host names:`, error);
		process.exit(1);
	}
}
