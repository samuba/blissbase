import 'dotenv/config';
import { E2E_TEST } from '$env/static/private';
import {
	createPostgresDrizzle,
	type DB
} from './db.shared';

export * from 'drizzle-orm';
export { buildConflictUpdateColumns, s } from './db.shared';

// Vite evaluates this module more than once (page SSR and remote functions).
// PGlite lives in memory, so each copy would be an empty database. One client on globalThis.
const e2eDbGlobal = globalThis as typeof globalThis & { __blissbaseE2EDb?: DB };

async function e2eDb() {
	if (e2eDbGlobal.__blissbaseE2EDb) return e2eDbGlobal.__blissbaseE2EDb;
	e2eDbGlobal.__blissbaseE2EDb = (await createPgliteDrizzle()) as unknown as DB;
	return e2eDbGlobal.__blissbaseE2EDb;
}

// not adding `| ReturnType<typeof createPgliteDrizzle>` because it has weird type errors when using .returning(...)
export const db: DB = E2E_TEST === `true` ? await e2eDb() : createPostgresDrizzle();

/**
 * Lazily loads the PGlite-backed Drizzle client for E2E runs.
 *
 * @example
 * await createPgliteDrizzle()
 */
async function createPgliteDrizzle() {
	const { createPgliteDrizzle } = await import('./db.pglite');
	return await createPgliteDrizzle();
}