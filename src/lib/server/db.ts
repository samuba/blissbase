import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js'
import { getTableColumns, sql, SQL } from 'drizzle-orm';
import postgres from 'postgres'
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';

export * from 'drizzle-orm';
export const s = schema;

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}

export const db = drizzle({
    client: postgres(process.env.DATABASE_URL, {
        prepare: false // Disable prefetch as it is not supported for "Transaction" pool mode
    }),
    schema,
    casing: 'snake_case'
});


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
            const colName = allColumns[column].name;
            acc[column] = sql.raw(`excluded.${colName}`);
            return acc;
        }, {} as Record<Q, SQL>);
};
