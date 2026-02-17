import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js'
import { getTableColumns, sql, SQL } from 'drizzle-orm';
import postgres from 'postgres'
import * as schema from './schema';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PGlite } from '@electric-sql/pglite';

export * from 'drizzle-orm';
export const s = schema;

/**
 * Creates the production Postgres drizzle instance.
 * @example
 * const db = createPostgresDb();
 */
const createPostgresDb = () => {
	if (!process.env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set');
	}

	return drizzle({
		client: postgres(process.env.DATABASE_URL, {
			prepare: false
		}),
		schema,
		casing: 'snake_case'
	});
};

/**
 * Creates and initializes the E2E PGlite drizzle instance.
 * @example
 * const db = await createPgliteDb();
 */
const createPgliteDb = async () => {
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle: pgliteDrizzle } = await import('drizzle-orm/pglite');
	const { cube } = await import('@electric-sql/pglite/contrib/cube');
	const { earthdistance } = await import('@electric-sql/pglite/contrib/earthdistance');
	const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');

	const client = new PGlite({
		extensions: { cube, earthdistance, pg_trgm }
	});

	await initializePglite({ client });
	console.log('E2E test database initialized');

	return pgliteDrizzle(client, { schema, casing: 'snake_case' });
};

/**
 * Applies required extensions and schema migrations for PGlite.
 * @example
 * await initializePglite({ client });
 */
const initializePglite = async ({ client }: InitializePgliteArgs) => {
	await client.exec('CREATE EXTENSION IF NOT EXISTS cube;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS earthdistance;');
	await client.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api') as typeof import('drizzle-kit/api');

	const prevJson = generateDrizzleJson({});
	const curJson = generateDrizzleJson(schema, prevJson.id, undefined, 'snake_case');
	const statements = await generateMigration(prevJson, curJson);

	for (const statement of statements) {
		try {
			await client.exec(statement);
		} catch (error) {
			if (isIgnorableMigrationError(error)) {
				continue;
			}

			throw error;
		}
	}
};

/**
 * Returns true for idempotent migration failures we can safely ignore.
 * @example
 * if (isIgnorableMigrationError(error)) continue;
 */
const isIgnorableMigrationError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.toLowerCase().includes('already exists');
};

export type Db = ReturnType<typeof createPostgresDb> | Awaited<ReturnType<typeof createPgliteDb>>;
export const db: Db = process.env.E2E_TEST === 'true'
	? await createPgliteDb()
	: createPostgresDb();

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

type InitializePgliteArgs = {
	client: PGlite;
};
