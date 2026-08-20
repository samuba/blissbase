import { db, s } from '$lib/server/db';
import {
	asc,
	count,
	gte,
	or,
	and,
	lt,
	isNotNull,
	lte,
	gt,
	sql,
	desc,
	eq,
	arrayOverlaps
} from 'drizzle-orm';
import { today as getToday, parseDate, CalendarDate } from '@internationalized/date';
import { reverseGeocodeCityCached } from '$lib/server/google';
import { resolveFilterCoordinates } from '$lib/server/locationDistance';
import { sanitizeLocationParams } from '$lib/locationFilter';
import type { InsertEvent } from '$lib/types';
import { escapeRegex, type Modify } from '$lib/common';
import * as v from 'valibot';
import { allTagsMap, type TagTranslation } from '$lib/server/tags';
import { eventCategorySlugs, OTHERS_CATEGORY_SLUG, getTagSlugsForCategories, getAssignedTagSlugs, getTagSlugsMatchingSearch } from '$lib/eventCategories';
import { attendanceModeEnum, type AttendanceMode } from './schema';
import { upsertEvents as upsertEventsShared } from './events.shared';
import { getPublicProfileBioExcerpt } from './profile';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');

export const eventWith = {
	author: {
		columns: {
			id: true,
			slug: true,
			displayName: true,
			profileImageUrl: true,
			bio: true,
			locale: true,
		}
	}
} as const;

/**
 * Fetches events based on various filtering criteria.
 *
 * Returns events that match ALL of the following conditions:
 *
 * 1. **Date Range**: Events that fall within the specified date range
 *    - Events that start within, end within, or span the range
 *    - Current and future ranges include ongoing events until 30% of their duration has elapsed
 *    - Events without an end time use a default duration of four hours
 *    - Historical ranges return all matching events without elapsed-time restrictions
 *
 * 2. **Location Filter** (if distance parameter provided):
 *    - Events within the specified distance (in km) from the given coordinates or geocoded address
 *    - Only events with valid latitude/longitude coordinates are included
 *
 * 3. **Search Term** (if provided):
 *    - Events where the search term matches the event name, description, or catalog tags (`tagSlugs`)
 *    - Matches a whole word, or the start or end of a longer word (space and punctuation count as boundaries)
 *
 * 4. **Pagination**: Limited to specified page size (max 20 events per page)
 *
 * 5. **Sorting**: By time (startAt) or distance from specified location
 *
 * The relevance timestamp is kept stable across paginated requests so offset pagination cannot skip events
 * as ongoing events age past the 30% threshold.
 *
 * @example
 * // Get events in Berlin within 10km, starting next week
 * const events = await fetchEvents({
 *   plzCity: 'Berlin',
 *   distance: '10',
 *   startDate: '2024-01-15',
 *   endDate: '2024-01-22'
 * });
 */
export async function fetchEvents(params: LoadEventsParams) {
	const sanitizedParams = sanitizeLocationParams(params);
	const { plzCity, distance, lat, lng, searchTerm, onlyOnlineEvents } = sanitizedParams;
	const categorySlugs = uniqueCategorySlugs(params.categorySlugs);
	const timeZone = 'Europe/Berlin';
	const today = getToday(timeZone);
	const startCalDate = params.startDate
		? parseDate(params.startDate)
		: new CalendarDate(today.year, today.month, today.day);
	const endCalDate = params.endDate ? parseDate(params.endDate) : startCalDate.add({ years: 99 });
	const limit = Math.min(params.limit ?? 10, 10);
	const page = Math.max(params.page ?? 1, 1);
	let sortBy = params.sortBy === 'distance' ? 'distance' : 'time';
	const sortOrder = params.sortOrder === 'desc' ? 'desc' : 'asc';
	const offset = (page - 1) * limit;
	const source = params.source?.trim() || null;

	const relevanceAt = parseRelevanceAt(params.relevanceAt);
	const relevanceAtIso = relevanceAt.toISOString();
	const startDate = startCalDate.toDate(timeZone);
	const endDate = new Date(endCalDate.toDate(timeZone).getTime() + 24 * 60 * 60 * 1000 - 1); // End of day

	let attendanceMode: AttendanceMode | null = params.attendanceMode ?? null;
	if (onlyOnlineEvents) attendanceMode = 'online'; // remove after some time

	// Check if the entire date range is in the past
	const isHistoricalRange = endDate <= relevanceAt;

	const effectiveEndAt = sql`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;
	const stillRelevantCondition = or(
		gte(s.events.startAt, relevanceAt), // Future events (haven't started yet)
		and(
			sql`${effectiveEndAt} >= ${relevanceAtIso}`, // Events that haven't ended yet (default end = start + 4h)
			sql`${relevanceAtIso} <= ${s.events.startAt} + 0.3 * (${effectiveEndAt} - ${s.events.startAt})`, // At most 30% of duration elapsed
		),
	);

	const startsInRange = and(
		gte(s.events.startAt, startDate),
		lte(s.events.startAt, endDate),
		isHistoricalRange ? undefined : stillRelevantCondition,
	);
	const endsInRange = and(
		isNotNull(s.events.endAt),
		gte(s.events.endAt, startDate),
		lte(s.events.endAt, endDate),
		isHistoricalRange ? undefined : stillRelevantCondition,
	);
	const spansRange = and(
		isNotNull(s.events.endAt),
		lt(s.events.startAt, startDate),
		gt(s.events.endAt, endDate),
		isHistoricalRange ? undefined : stillRelevantCondition,
	);
	const dateCondition = or(startsInRange, endsInRange, spansRange);
	const allConditions = [and(s.events.listed), dateCondition];

	if (source) {
		allConditions.push(eq(s.events.source, source));
	}

	if (!attendanceMode || attendanceMode === 'offline+online') {
		allConditions.push(or(
            eq(s.events.attendanceMode, 'offline+online'), 
            eq(s.events.attendanceMode, 'online'), 
            eq(s.events.attendanceMode, 'offline'))
        );
	} else {
		allConditions.push(eq(s.events.attendanceMode, attendanceMode));
	}

    let geocodedCoords: { lat: number; lng: number } | null = null;

	if ((attendanceMode === 'offline' || attendanceMode === 'offline+online' || !attendanceMode) && distance) {
		geocodedCoords = await resolveFilterCoordinates({
			plzCity,
			lat,
			lng,
			apiKey: GOOGLE_MAPS_API_KEY,
		});

        if (geocodedCoords) {
            const distanceMeters = parseFloat(distance) * 1000;
            const proximityCondition = sql`earth_distance(ll_to_earth(${s.events.latitude}, ${s.events.longitude}), ll_to_earth(${geocodedCoords.lat}, ${geocodedCoords.lng})) <= ${distanceMeters} AND ${s.events.latitude} IS NOT NULL AND ${s.events.longitude} IS NOT NULL`;
            allConditions.push(proximityCondition);
		}
	}

	if (sortBy === 'distance' && !geocodedCoords) {
		sortBy = 'time';
	}

	let orderByClause; // also sorting by event.id cuz if events have same startAt, svelte hydration can mix them up and we have mismatched images
	if (sortBy === 'distance' && geocodedCoords) {
		const distanceSortSql = sql`
            CASE
                WHEN ${s.events.longitude} IS NOT NULL AND ${s.events.latitude} IS NOT NULL THEN
                    earth_distance(ll_to_earth(${s.events.latitude}, ${s.events.longitude}), ll_to_earth(${geocodedCoords.lat}, ${geocodedCoords.lng}))
                ELSE NULL
            END`;
		if (sortOrder === 'asc') {
			orderByClause = [sql`${distanceSortSql} ASC NULLS LAST`, asc(s.events.id)];
		} else {
			orderByClause = [sql`${distanceSortSql} DESC NULLS LAST`, asc(s.events.id)];
		}
	} else {
		if (sortOrder === 'asc') {
			orderByClause = [asc(s.events.startAt), asc(s.events.id)];
		} else {
			orderByClause = [desc(s.events.startAt), asc(s.events.id)];
		}
	}

	if (searchTerm && searchTerm.trim() !== '') {
		// Split by spaces but keep quoted phrases together
		const searchWords =
			searchTerm
				.trim()
				.match(/(?:[^\s"]+|"[^"]*")+/g)
				?.map(
					(word) => word.replace(/^"|"$/g, '') // Remove surrounding quotes
				)
				.filter(Boolean) || [];

		// For each word, create a condition that checks all searchable fields
		const wordConditions = searchWords.map((word) => {
			const matchingTagSlugs = getTagSlugsMatchingSearch(word);
			const pattern = wholeWordPostgresPattern(word);

			return or(
				sql`${s.events.name} ~* ${pattern}`,
				sql`${s.events.description} ~* ${pattern}`,
				matchingTagSlugs.length ? arrayOverlaps(s.events.tagSlugs, matchingTagSlugs) : undefined,
				sql<boolean>`EXISTS (SELECT 1 FROM unnest(COALESCE(${s.events.tagSlugs}, ARRAY[]::text[])) AS t(slug) WHERE t.slug ~* ${pattern})`,
			);
		});

		if (wordConditions.length) {
			const searchTermCondition = or(...wordConditions);
			allConditions.push(searchTermCondition);
		}
	}

	if (categorySlugs.length) {
		const includeOthers = categorySlugs.includes(OTHERS_CATEGORY_SLUG);
		const mappedSlugs = getTagSlugsForCategories(categorySlugs);
		const categoryConditions = [];

		if (mappedSlugs.length) {
			categoryConditions.push(arrayOverlaps(s.events.tagSlugs, mappedSlugs));
		}

		if (includeOthers) {
			const assignedSlugs = [...getAssignedTagSlugs()];
			categoryConditions.push(
				sql`EXISTS (
					SELECT 1 FROM unnest(COALESCE(${s.events.tagSlugs}, ARRAY[]::text[])) AS t(slug)
					WHERE t.slug NOT IN (${sql.join(assignedSlugs.map((slug) => sql`${slug}`), sql`, `)})
				)`
			);
			categoryConditions.push(sql`COALESCE(cardinality(${s.events.tagSlugs}), 0) = 0`);
		}

		allConditions.push(categoryConditions.length ? or(...categoryConditions) : sql`false`);
	}

	const finalCondition = and(...allConditions.filter(Boolean));

	const eventsQuery = db.query.events.findMany({
		where: finalCondition,
		orderBy: orderByClause,
		limit: limit,
		offset: offset,
		with: eventWith,
		extras: {
			distanceKm: geocodedCoords
				? sql<number | null>`
            CASE
                WHEN ${s.events.longitude} IS NOT NULL AND ${s.events.latitude} IS NOT NULL THEN
                    GREATEST(1, ROUND(earth_distance(ll_to_earth(${s.events.latitude}, ${s.events.longitude}), ll_to_earth(${geocodedCoords.lat}, ${geocodedCoords.lng})) / 1000))
                ELSE NULL
            END
        `.as('distance_km')
				: sql<null>`NULL`.as('distance_km')
		}
	});

	const totalEventsQuery = db.select({ count: count() }).from(s.events).where(finalCondition);

	const startTime = performance.now();
	const [events, totalResult] = await Promise.all([eventsQuery, totalEventsQuery]);
	const endTime = performance.now();
	console.log(`Query execution time: ${endTime - startTime}ms`);

	const totalEvents = totalResult[0].count;
	const totalPages = Math.ceil(totalEvents / limit);

	const usedLat = geocodedCoords ? geocodedCoords.lat : lat;
	const usedLng = geocodedCoords ? geocodedCoords.lng : lng;

	// Resolve city name from coordinates if using current location
	let resolvedCityName: string | null = null;
	if (lat != null && lng != null && !plzCity) {
		// Only resolve city name when using coordinates directly (not when plzCity was provided)
		resolvedCityName = await reverseGeocodeCityCached(lat, lng, GOOGLE_MAPS_API_KEY);
	}

	return {
		events,
		pagination: {
			startDate: params.startDate ? startCalDate.toString() : undefined,
			endDate: params.endDate ? endCalDate.toString() : undefined,
			lat: usedLat,
			lng: usedLng,
			totalEvents,
			totalPages,
			plzCity: resolvedCityName || plzCity,
			distance,
			page,
			limit,
			searchTerm,
			sortBy,
			sortOrder,
			categorySlugs: categorySlugs.length ? categorySlugs : undefined,
			attendanceMode,
			source,
			relevanceAt: relevanceAtIso
		} satisfies LoadEventsParams & { totalEvents: number; totalPages: number }
	};
}

function wholeWordPostgresPattern(word: string) {
	const escaped = escapeRegex(word);
	return `\\m${escaped}|${escaped}\\M`;
}

function uniqueCategorySlugs(categorySlugs?: string[] | null) {
	if (!categorySlugs?.length) return [];
	const seen = new Set<string>();
	const slugs: string[] = [];
	for (const slug of categorySlugs) {
		if (!eventCategorySlugs.has(slug) || seen.has(slug)) continue;
		seen.add(slug);
		slugs.push(slug);
	}
	return slugs;
}

function parseRelevanceAt(value?: string | null) {
	const parsed = value ? new Date(value) : new Date();
	if (!Number.isNaN(parsed.getTime())) return parsed;
	return new Date();
}

type TempFetchEventsResult = Awaited<ReturnType<typeof fetchEvents>>;
type FetchEventsResult = Modify<
	TempFetchEventsResult,
	{
		events: Modify<
			TempFetchEventsResult['events'][number],
			{ distanceKm?: number | null | undefined }
		>[];
	}
>;
type FetchEvent = FetchEventsResult['events'][number];

type StringOrTagTranslation = string & TagTranslation;
// const ASI_ROOMS = ['asi_de_at_ch', 'asi_regio_at_by', 'asi_regio_nord', 'asi_regio_ost', 'asi_regio_sw', 'asi_regio_west'];
export function prepareEventsForUi(events: FetchEvent[]) {
	return (
		events
			// filter ASI rooms
			// .filter(event => {
			//     const ASI_ROOMS = ['asi_de_at_ch', 'asi_regio_at_by', 'asi_regio_nord', 'asi_regio_ost', 'asi_regio_sw', 'asi_regio_west'];
			//     if (event.sourceChatIdsTelegram?.every(roomId => ASI_ROOMS.includes(roomId))) {
			//         return false;
			//     }
			//     return true;
			// })
			.map((event) => {
				// hide that we took event from AIN channels. Stop when we have official cooperation with AIN.
				if (event.host?.includes('Authentic Intimacy Network')) {
					event.host = null;
				}
				return {
					...event,
					tags: event.tags?.map((x) => allTagsMap.get(x) ?? x) as StringOrTagTranslation[],
					hostSecret: undefined, // never leak this to the ui
					author: event.author ? {
						...event.author,
						bio: getPublicProfileBioExcerpt({ bio: event.author?.bio })
					} : undefined
				};
			})
	);
}

export function prepareEventsResultForUi(result: FetchEventsResult) {
	return {
		...result,
		events: prepareEventsForUi(result.events)
	};
}

export async function upsertEvents(events: InsertEvent[]) {
	return await upsertEventsShared(db, events);
}

export const loadEventsParamsSchema = v.partial(
	v.object({
		startDate: v.nullable(v.string()), // 2022-01-01
		endDate: v.nullable(v.string()), // 2022-01-01
		page: v.nullable(v.number()),
		limit: v.nullable(v.number()),
		plzCity: v.nullable(v.string()),
		distance: v.nullable(v.string()),
		lat: v.nullable(v.number()),
		lng: v.nullable(v.number()),
		searchTerm: v.nullable(v.string()),
		sortBy: v.nullable(v.string()),
		sortOrder: v.nullable(v.string()),
		categorySlugs: v.nullable(v.array(v.string())),
		onlyOnlineEvents: v.nullable(v.boolean()), // TODO: remove after some time
		attendanceMode: v.nullable(v.picklist(attendanceModeEnum)),
		source: v.nullable(v.string()),
		relevanceAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
		// these are not used as params but are returned in the pagination object
		totalEvents: v.nullable(v.number()),
		totalPages: v.nullable(v.number())
	})
);

export type LoadEventsParams = v.InferInput<typeof loadEventsParamsSchema>;

export type UiEvent = ReturnType<typeof prepareEventsForUi>[number];
