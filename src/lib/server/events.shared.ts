import { generateSlug } from '../common';
import type { InsertEvent } from '../types';
import { buildConflictUpdateColumns, type DB, s } from './db.shared';
import { sql } from 'drizzle-orm';

/**
 * Inserts events using the shared upsert behavior for both app code and Bun scripts.
 */
export async function upsertEvents(db: DB, events: InsertEvent[]) {
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
			set: {
				...buildConflictUpdateColumns(s.events, [`slug`, `id`, `createdAt`]),
				// Preserve existing legacy tags when a scrape has no tags, otherwise merge both sides.
				tags: sql`
					case
						when excluded.tags is null or coalesce(array_length(excluded.tags, 1), 0) = 0 then ${s.events.tags}
						when ${s.events.tags} is null or coalesce(array_length(${s.events.tags}, 1), 0) = 0 then excluded.tags
						else array(
							select distinct tag
							from unnest(${s.events.tags} || excluded.tags) as merged_tags(tag)
						)
					end
				`
			}
		})
		.returning();
}
