import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema';

if (!process.env.DATABASE_URL_NEON) {
    throw new Error('DATABASE_URL_NEON is not set');
}

export const db = drizzle({
    client: postgres(process.env.DATABASE_URL_NEON, {
        prepare: false // Disable prefetch as it is not supported for "Transaction" pool mode
    }),
    schema,
    casing: 'snake_case'
});

export * from 'drizzle-orm';

export const s = schema
