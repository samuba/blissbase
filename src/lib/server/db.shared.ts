import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';

const casing = `snake_case`;

export const s = schema;

/**
 * Creates the default postgres-backed Drizzle client.
 *
 * @example
 * createPostgresDrizzle()
 * createPostgresDrizzle({ max: 2 })
 */
export function createPostgresDrizzle(options: Omit<postgres.Options<Record<string, postgres.PostgresType>>, `prepare`> & {
	// postgres.js applies max_pipeline at runtime; the published Options type omits it
	max_pipeline?: number
} = {}) {
	return drizzle({
		client: postgres(process.env.DATABASE_URL!, {
			...options,
			// Supabase pooler (Supavisor) does not support prepared statements in transaction mode
			prepare: false
		}),
		schema,
		casing
	});
}

/**
 * Builds a set of columns to update when using the `onConflictDoUpdate` method.
 * Excludes the specified columns from being updated.
 *
 * @example
 * buildConflictUpdateColumns(s.events, [`slug`, `id`, `createdAt`])
 */
export const buildConflictUpdateColumns = <
	T extends PgTable,
	Q extends keyof T[`_`][`columns`]
>(
	table: T,
	columnsToNotUpdate: Q[],
) => {
	const allColumns = getTableColumns(table);
	const allColumnKeys = Object.keys(allColumns) as Q[];

	return allColumnKeys
		.filter((column) => !columnsToNotUpdate.includes(column))
		.reduce((acc, column) => {
			const colName = allColumns[column].name.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`); // https://github.com/drizzle-team/drizzle-orm/issues/1728
			acc[column] = sql.raw(`excluded.${colName}`);
			return acc;
		}, {} as Record<Q, SQL>);
};

export type DB = ReturnType<typeof createPostgresDrizzle>;
