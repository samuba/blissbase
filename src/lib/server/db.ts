import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';
import ws from 'ws';
import { sql } from 'drizzle-orm';
import type { InsertEvent } from '$lib/types';

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

export const s = schema

export async function insertEvent(event: InsertEvent) {
    // trim all strings 
    type EventKey = keyof InsertEvent;
    for (const key in event) {
        if (Object.prototype.hasOwnProperty.call(event, key) && typeof event[key as EventKey] === 'string') {
            (event[key as EventKey] as string) = (event[key as EventKey] as string).trim();
        }
    }

    return db.insert(s.events)
        .values(event)
        .onConflictDoUpdate({
            target: [schema.events.name, schema.events.startAt, schema.events.address],
            set: {
                name: sql`excluded.name`,
                startAt: sql`excluded.start_at`,
                endAt: sql`excluded.end_at`,
                address: sql`excluded.address`,
                price: sql`excluded.price`,
                description: sql`excluded.description`,
                summary: sql`excluded.summary`,
                imageUrls: sql`excluded.image_urls`,
                host: sql`excluded.host`,
                hostLink: sql`excluded.host_link`,
                contact: sql`excluded.contact`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                tags: sql`excluded.tags`,
                source: sql`excluded.source`,
                sourceUrl: sql`excluded.source_url`,
                scrapedAt: sql`CURRENT_TIMESTAMP`,
            }
        })
        .returning({ insertedId: schema.events.id });
}