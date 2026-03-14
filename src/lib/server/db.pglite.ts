import type { PGlite } from '@electric-sql/pglite';
import * as schema from './schema';

const casing = `snake_case`;

/**
 * Creates the transient PGlite database used by E2E tests.
 *
 * @example
 * await createPgliteDrizzle()
 */
export async function createPgliteDrizzle() {
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle: pgliteDrizzle } = await import('drizzle-orm/pglite');
	const { cube } = await import('@electric-sql/pglite/contrib/cube');
	const { earthdistance } = await import('@electric-sql/pglite/contrib/earthdistance');
	const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');

	const client = new PGlite({
		extensions: { cube, earthdistance, pg_trgm }
	});

	await migratePglite(client);
	console.log(`E2E test database migrated`);

	return pgliteDrizzle(client, {
		schema,
		casing
	});
}

/**
 * Applies the current Drizzle schema to the transient PGlite database.
 *
 * @example
 * await migratePglite(client)
 */
async function migratePglite(client: PGlite) {
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api') as typeof import('drizzle-kit/api');

	const prevJson = generateDrizzleJson({});
	const curJson = generateDrizzleJson(schema, prevJson.id, undefined, `snake_case`);
	const statements = await generateMigration(prevJson, curJson);

	for (const statement of statements) {
		await client.exec(statement);
	}
}
