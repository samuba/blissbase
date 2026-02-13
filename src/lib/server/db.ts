import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js'
import { getTableColumns, sql, SQL } from 'drizzle-orm';
import postgres from 'postgres'
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';

export * from 'drizzle-orm';
export const s = schema;

// E2E test mode uses PGlite instead of PostgreSQL
let db: any;

if (process.env.E2E_TEST === 'true') {
	// For E2E tests, dynamically import PGlite
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle: pgliteDrizzle } = await import('drizzle-orm/pglite');
	const { cube } = await import('@electric-sql/pglite/contrib/cube');
	const { earthdistance } = await import('@electric-sql/pglite/contrib/earthdistance');
	const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');

	const client = new PGlite({
		extensions: { cube, earthdistance, pg_trgm }
	});

	db = pgliteDrizzle(client, { schema, casing: 'snake_case' });

	// Initialize extensions and schema
	await client.exec('CREATE EXTENSION IF NOT EXISTS cube;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS earthdistance;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

	// Push schema using drizzle-kit API
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api');

	const prevJson = generateDrizzleJson({});
	const curJson = generateDrizzleJson(schema, prevJson.id, undefined, 'snake_case');
	const statements = await generateMigration(prevJson, curJson);

	for (const statement of statements) {
		try {
			await client.exec(statement);
		} catch (e) {
			// Ignore errors for existing tables
		}
	}
	console.log('E2E test database initialized');
} else {
	if (!process.env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set');
	}

	db = drizzle({
		client: postgres(process.env.DATABASE_URL, {
			prepare: false
		}),
		schema,
		casing: 'snake_case'
	});
}

export { db };

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
