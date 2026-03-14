import 'dotenv/config';
import { E2E_TEST } from '$env/static/private';
import { drizzle } from 'drizzle-orm/postgres-js'
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres'
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';

const casing = 'snake_case';

export * from 'drizzle-orm';
export const s = schema;

type DB = ReturnType<typeof createPostgresDrizzle>; // not adding `| ReturnType<typeof createPgliteDrizzle>`  because it has weird type errors when using .returning(...) 
export const db: DB = E2E_TEST === `true` ? 
	await createPgliteDrizzle() as unknown as DB : 
	createPostgresDrizzle();

function createPostgresDrizzle() {
	return drizzle({
		client: postgres(process.env.DATABASE_URL!, {
			prepare: false
		}),
		schema,
		casing
	});
};

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