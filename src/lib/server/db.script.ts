import 'dotenv/config';
import { createPostgresDrizzle } from './db.shared';
import type { InsertEvent } from '$lib/types';
import { upsertEvents as upsertEventsShared } from './events.shared';

export * from 'drizzle-orm';
export { s } from './db.shared';
export const db = createPostgresDrizzle();

export async function upsertEvents(events: InsertEvent[]) {
	return await upsertEventsShared(db, events);
}
