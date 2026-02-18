import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, getTableColumns, getTableName, sql, SQL } from 'drizzle-orm';
import postgres from 'postgres'
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PGlite } from '@electric-sql/pglite';
import { DATABASE_URL, E2E_TEST } from '$env/static/private';

const casing = 'snake_case';

export * from 'drizzle-orm';
export const s = schema;

type DB = ReturnType<typeof createPostgresDrizzle>; // not adding `| ReturnType<typeof createPgliteDrizzle>`  because it has weird type errors when using .returning(...) 
export const db: DB = E2E_TEST === 'true' ? 
	await createPgliteDrizzle() as unknown as DB : 
	createPostgresDrizzle();

function createPostgresDrizzle() {
	return drizzle({
		client: postgres(DATABASE_URL, {
			prepare: false
		}),
		schema,
		casing
	});
};

// Only used for E2E tests
async function createPgliteDrizzle() {
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle: pgliteDrizzle } = await import('drizzle-orm/pglite');
	const { cube } = await import('@electric-sql/pglite/contrib/cube');
	const { earthdistance } = await import('@electric-sql/pglite/contrib/earthdistance');
	const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');

	const client = new PGlite({
		extensions: { cube, earthdistance, pg_trgm }
	});

	await migratePglite(client);
	console.log('E2E test database migrated');

	return pgliteDrizzle(client, { 
		schema, 
		casing
	});
};

async function migratePglite(client: PGlite) {
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api') as typeof import('drizzle-kit/api');

	const prevJson = generateDrizzleJson({});
	const curJson = generateDrizzleJson(schema, prevJson.id, undefined, 'snake_case');
	const statements = await generateMigration(prevJson, curJson);

	for (const statement of statements) {
		await client.exec(statement);
	}
};

/**
 * Builds a set of columns to update when using the `onConflictDoUpdate` method.
 * Excludes the specified columns from being updated.
 */
export const buildConflictUpdateColumns = <
	T extends PgTable,
	Q extends keyof T['_']['columns']
>(
	table: T,
	columnsToNotUpdate: Q[],
) => {
	const allColumns = getTableColumns(table);
	const allColumnKeys = Object.keys(allColumns) as Q[];
	return allColumnKeys
		.filter(column => !columnsToNotUpdate.includes(column))
		.reduce((acc, column) => {
			const colName = allColumns[column].name.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`); // https://github.com/drizzle-team/drizzle-orm/issues/1728
			acc[column] = sql.raw(`excluded.${colName}`);
			return acc;
		}, {} as Record<Q, SQL>);
};