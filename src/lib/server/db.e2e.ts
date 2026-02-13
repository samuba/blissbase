// Mock database for E2E tests using PGlite
// This file is aliased in playwright.config.ts when running E2E tests

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { getTableColumns, sql, SQL } from 'drizzle-orm';
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';

export * from 'drizzle-orm';
export const s = schema;

// Create PGlite client
const client = new PGlite({
	extensions: { cube, earthdistance, pg_trgm }
});

export const db = drizzle(client, { schema, casing: 'snake_case' });

// Initialize database
const initPromise = (async () => {
	await client.exec('CREATE EXTENSION IF NOT EXISTS cube;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS earthdistance;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

	// Push schema
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
})();

// Export init promise for tests to await if needed
export { initPromise as $initPromise };

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
			const colName = allColumns[column].name.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`);
			acc[column] = sql.raw(`excluded.${colName}`);
			return acc;
		}, {} as Record<Q, SQL>);
};
