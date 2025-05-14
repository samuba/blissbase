import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';
import ws from 'ws';
// import { DATABASE_URL } from '$env/static/private';

neonConfig.webSocketConstructor = ws;

// To work in edge environments (Cloudflare Workers, Vercel Edge, etc.), enable querying over fetch
// neonConfig.poolQueryViaFetch = true

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}

export const db = drizzle({
    client: neon(process.env.DATABASE_URL),
    schema,
    casing: 'snake_case'
});

export * from 'drizzle-orm';