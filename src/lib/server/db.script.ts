import 'dotenv/config';
import { createPostgresDrizzle } from './db.shared';
import type { InsertEvent } from '$lib/types';
import { upsertEvents as upsertEventsShared } from './events.shared';

export * from 'drizzle-orm';
export { s } from './db.shared';

/**
 * Script/CI client: kept tiny so parallel GitHub Actions matrix jobs don't exhaust
 * the Supavisor session-mode pool (pool_size 15, EMAXCONNSESSION).
 */
export const db = createPostgresDrizzle({
	max: Number(process.env.DB_POOL_MAX ?? 2),
	max_pipeline: 1,
	idle_timeout: 20,
	connect_timeout: 30,
});

let closed = false;

/**
 * Closes the postgres-js pool so the pooler slot is released before the process exits.
 *
 * @example
 * await closeDb()
 */
export async function closeDb() {
	if (closed) return;
	closed = true;
	try {
		await db.$client.end({ timeout: 5 });
	} catch (e) {
		console.warn(`closeDb: failed to end postgres client`, e);
	}
}

/**
 * Closes the DB pool, then exits with the given code.
 *
 * @example
 * await exitWithDbClose(1)
 */
export async function exitWithDbClose(code: number): Promise<never> {
	await closeDb();
	process.exit(code);
}

export async function upsertEvents(events: InsertEvent[]) {
	return await upsertEventsShared(db, events);
}
