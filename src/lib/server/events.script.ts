import type { InsertEvent } from '../types';
import { db } from './db.script';
import { insertEventsWithDb } from './events.shared';

/**
 * Inserts events for Bun scripts using the shared event upsert logic.
 *
 * @example
 * await insertEvents([event])
 */
export async function insertEvents(events: InsertEvent[]) {
	return await insertEventsWithDb(db, events);
}
