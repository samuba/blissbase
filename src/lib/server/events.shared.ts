import { generateSlug } from '../common';
import type { InsertEvent } from '../types';
import { buildConflictUpdateColumns, type DB, s } from './db.shared';

/**
 * Inserts events using the shared upsert behavior for both app code and Bun scripts.
 *
 * @example
 * await insertEventsWithDb(db, [event])
 */
export async function insertEventsWithDb(db: DB, events: InsertEvent[]) {
	const processedEvents = events.map((event) => {
		type EventKey = keyof InsertEvent;

		for (const key in event) {
			if (
				Object.prototype.hasOwnProperty.call(event, key) &&
				typeof event[key as EventKey] === `string`
			) {
				(event[key as EventKey] as string) = (event[key as EventKey] as string).trim();
			}
		}

		event.slug = generateSlug({
			name: event.name,
			startAt: event.startAt,
			endAt: event.endAt ?? undefined
		});

		if (event.latitude !== undefined && event.latitude !== null) {
			if (isNaN(event.latitude) || event.latitude < -90 || event.latitude > 90) {
				event.latitude = undefined;
			}
		}

		if (event.longitude !== undefined && event.longitude !== null) {
			if (isNaN(event.longitude) || event.longitude < -180 || event.longitude > 180) {
				event.longitude = undefined;
			}
		}

		return event;
	});

	return await db
		.insert(s.events)
		.values(processedEvents)
		.onConflictDoUpdate({
			target: s.events.slug,
			set: buildConflictUpdateColumns(s.events, [`slug`, `id`, `createdAt`])
		})
		.returning();
}
