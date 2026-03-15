import 'dotenv/config';
import { E2E_TEST } from '$env/static/private';
import {
	createPostgresDrizzle,
	type DB
} from './db.shared';

export * from 'drizzle-orm';
export { buildConflictUpdateColumns, s } from './db.shared';

// not adding `| ReturnType<typeof createPgliteDrizzle>` because it has weird type errors when using .returning(...)
export const db: DB = E2E_TEST === `true` ? 
	await createPgliteDrizzle() as unknown as DB : 
	createPostgresDrizzle();

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