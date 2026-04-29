import { generateSlug } from '../common';
import type { InsertEvent } from '../types';
import { buildConflictUpdateColumns, type DB, s } from './db.shared';
import { sql } from 'drizzle-orm';

export const FORM_CREATED_EVENT_SOURCE = `website-form`;

/**
 * Source-of-truth pattern for matching Blissbase-owned hosts. Shared by the JS
 * fallback in {@link isBlissbaseUrl} and the Postgres `~*` filter in {@link upsertEvents}
 * so the rules cannot drift apart.
 */
const BLISSBASE_HOST_PATTERN = String.raw`(^|://)([^/]*\.)?blissbase\.app([/:?#]|$)`;
const BLISSBASE_HOST_REGEX = new RegExp(BLISSBASE_HOST_PATTERN, `i`);

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

		if (event.sourceUrl !== undefined) {
			event.sourceUrl = normalizeSourceUrl(event.sourceUrl);
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
				source: sql`
					case
						when ${s.events.source} = ${FORM_CREATED_EVENT_SOURCE} then ${s.events.source}
						else excluded.source
					end
				`,
				authorId: sql`
					case
						when ${s.events.source} = ${FORM_CREATED_EVENT_SOURCE} then ${s.events.authorId}
						else excluded.author_id
					end
				`,
				hostSecret: sql`
					case
						when ${s.events.source} = ${FORM_CREATED_EVENT_SOURCE} then ${s.events.hostSecret}
						else excluded.host_secret
					end
				`,
				sourceUrl: sql`
					case
						when excluded.source_url is not null and excluded.source_url ~* ${sql.raw(`'${BLISSBASE_HOST_PATTERN}'`)} then null
						when excluded.source_url is not null then excluded.source_url
						when ${s.events.sourceUrl} is not null and ${s.events.sourceUrl} ~* ${sql.raw(`'${BLISSBASE_HOST_PATTERN}'`)} then null
						else excluded.source_url
					end
				`,
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

/**
 * Removes Blissbase-owned URLs from event source links before persistence.
 *
 * @example
 * normalizeSourceUrl(`https://blissbase.app/my-event`)
 */
export function normalizeSourceUrl(sourceUrl: string | null | undefined) {
	if (!sourceUrl?.trim()) return null;
	const trimmed = sourceUrl.trim();
	if (isBlissbaseUrl(trimmed)) return null;
	return trimmed;
}

/**
 * Detects Blissbase app URLs with or without a protocol.
 *
 * @example
 * isBlissbaseUrl(`blissbase.app/events/demo`)
 */
export function isBlissbaseUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return false;

	try {
		const url = new URL(trimmed.includes(`://`) ? trimmed : `https://${trimmed}`);
		const hostname = url.hostname.toLowerCase();
		return hostname === `blissbase.app` || hostname.endsWith(`.blissbase.app`);
	} catch {
		return BLISSBASE_HOST_REGEX.test(trimmed);
	}
}
