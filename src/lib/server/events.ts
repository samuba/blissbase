import { buildConflictUpdateColumns, db, s } from '$lib/server/db';
import {
	asc,
	count,
	gte,
	or,
	and,
	lt,
	isNotNull,
	isNull,
	lte,
	gt,
	sql,
	ilike,
	desc,
	SQL,
	inArray,
	exists,
	eq
} from 'drizzle-orm';
import { today as getToday, parseDate, CalendarDate } from '@internationalized/date';
import { geocodeAddressCached, reverseGeocodeCityCached } from '$lib/server/google';
import type { InsertEvent } from '$lib/types';
import { generateSlug, type Modify } from '$lib/common';
import * as v from 'valibot';
import { allTagsMap, type TagTranslation } from '$lib/tags';
import { attendanceModeEnum, eventAttendanceModeEnum, type AttendanceMode } from './schema';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');

export const eventWith = {
	eventTags: {
		columns: {},
		with: {
			tag: {
				columns: {},
				with: {
					translations: {
						columns: {
							name: true,
							locale: true,
							tagId: true
						}
					}
				}
			}
		}
	}
} as const;

/**
 * Fetches events based on various filtering criteria.
 *
 * Returns events that match ALL of the following conditions:
 *
 * 1. **Date Range**: Events that fall within the specified date range
 *    - Events that start within the range
 *    - Events that end within the range (must have started within last 6 hours for current/future ranges)
 *    - Events that span the entire range (must have started within last 6 hours for current/future ranges)
 *    - Never returns events that started more than 6 hours ago (except for historical date ranges)
 *    - Historical ranges (both startDate and endDate in the past) return all events without time restrictions
 *
 * 2. **Location Filter** (if distance parameter provided):
 *    - Events within the specified distance (in km) from the given coordinates or geocoded address
 *    - Only events with valid latitude/longitude coordinates are included
 *
 * 3. **Search Term** (if provided):
 *    - Events where the search term matches the event name, description, or any tag
 *    - Case-insensitive partial matching
 *
 * 4. **Pagination**: Limited to specified page size (max 20 events per page)
 *
 * 5. **Sorting**: By time (startAt) or distance from specified location
 *
 * Events are excluded if they started more than 6 hours ago and don't meet the ongoing event criteria.
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
	const { plzCity, distance, lat, lng, searchTerm, tagIds, onlyOnlineEvents } = params;
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

	const now = new Date();
	const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
	const startDate = startCalDate.toDate(timeZone);
	const endDate = new Date(endCalDate.toDate(timeZone).getTime() + 24 * 60 * 60 * 1000 - 1); // End of day

	let attendanceMode: AttendanceMode | null = params.attendanceMode ?? null;
	if (onlyOnlineEvents) attendanceMode = 'online'; // remove after some time

	// Check if the entire date range is in the past
	const isHistoricalRange = endDate <= now;

	const startsInRange = and(
		gte(s.events.startAt, startDate),
		lte(s.events.startAt, endDate),
		isHistoricalRange
			? undefined
			: or(
					gte(s.events.startAt, sql`NOW()`), // Future events (haven't started yet)
					and(
						gte(s.events.startAt, twoHoursAgo), // Recent events (started within last 6 hours)
						or(
							isNull(s.events.endAt), // Events without end time
							gte(s.events.endAt, sql`NOW()`) // Events that haven't ended yet
						)
					)
				)
	);
	const endsInRange = and(
		isNotNull(s.events.endAt),
		gte(s.events.endAt, startDate),
		lte(s.events.endAt, endDate),
		isHistoricalRange
			? undefined
			: and(
					gte(s.events.startAt, twoHoursAgo),
					gte(s.events.endAt, sql`NOW()`) // Event hasn't ended yet
				)
	);
	const spansRange = and(
		isNotNull(s.events.endAt),
		lt(s.events.startAt, startDate),
		gt(s.events.endAt, endDate),
		isHistoricalRange
			? undefined
			: and(
					gte(s.events.startAt, twoHoursAgo),
					gte(s.events.endAt, sql`NOW()`) // Event hasn't ended yet
				)
	);
	const dateCondition = or(startsInRange, endsInRange, spansRange);
	const allConditions = [and(s.events.listed), dateCondition];

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
		if (lat && lng) {
			if (!isNaN(lat) && !isNaN(lng)) {
				geocodedCoords = { lat, lng };
			} else {
				console.error('Invalid lat/lng parameters:', lat, lng);
			}
		} else if (plzCity && plzCity.trim() !== '') {
			geocodedCoords = await geocodeAddressCached([plzCity], GOOGLE_MAPS_API_KEY);
		}

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
				) || [];

		// For each word, create a condition that checks all searchable fields
		const wordConditions = searchWords.map((word) =>
			or(
				ilike(s.events.name, `%${word}%`),
				sql<boolean>`EXISTS (SELECT 1 FROM unnest(${s.events.tags}) AS t(tag) WHERE t.tag ILIKE ${`%${word}%`})`,
				ilike(s.events.description, `%${word}%`),
				exists(
					db
						.select({ eventId: s.eventTags.eventId })
						.from(s.eventTags)
						.innerJoin(s.tagTranslations, eq(s.eventTags.tagId, s.tagTranslations.tagId))
						.where(
							and(eq(s.eventTags.eventId, s.events.id), ilike(s.tagTranslations.name, `%${word}%`))
						)
				)
			)
		);

		// All words must match (AND logic)
		const searchTermCondition = or(...wordConditions);
		allConditions.push(searchTermCondition);
	}

	// not needed anymore as everything is handled using searchTerm
	// if (tagIds?.length) {
	//     const tagCondition = exists(
	//         db.select({ tagId: s.eventTags.tagId })
	//             .from(s.eventTags)
	//             .where(
	//                 and(
	//                     eq(s.eventTags.eventId, s.events.id),
	//                     inArray(s.eventTags.tagId, tagIds)
	//                 )
	//             )
	//     );
	//     allConditions.push(tagCondition);
	// }

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
	if (lat && lng && !plzCity) {
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
			tagIds,
			attendanceMode
		} satisfies LoadEventsParams & { totalEvents: number; totalPages: number }
	};
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
			//     if (event.telegramRoomIds?.every(roomId => ASI_ROOMS.includes(roomId))) {
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
					tags2: event.eventTags?.flatMap((x) => x.tag.translations) ?? [],
					eventTags: undefined,
					hostSecret: undefined // never leak this to the ui
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

export async function insertEvents(events: InsertEvent[]) {
	const processedEvents = events.map((event) => {
		// trim all strings
		type EventKey = keyof InsertEvent;
		for (const key in event) {
			if (
				Object.prototype.hasOwnProperty.call(event, key) &&
				typeof event[key as EventKey] === 'string'
			) {
				(event[key as EventKey] as string) = (event[key as EventKey] as string).trim();
			}
		}

		event.slug = generateSlug({
			name: event.name,
			startAt: event.startAt,
			endAt: event.endAt ?? undefined
		});

		// Validate and clean up latitude/longitude values
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

	const result = await db
		.insert(s.events)
		.values(processedEvents)
		.onConflictDoUpdate({
			target: s.events.slug,
			set: buildConflictUpdateColumns(s.events, ['slug', 'id', 'createdAt'])
		})
		.returning();

	return result;
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
		tagIds: v.nullable(v.array(v.number())),
		onlyOnlineEvents: v.nullable(v.boolean()), // TODO: remove after some time
		attendanceMode: v.nullable(v.picklist(attendanceModeEnum)),
		// these are not used as params but are returned in the pagination object
		totalEvents: v.nullable(v.number()),
		totalPages: v.nullable(v.number())
	})
);

type LoadEventsParams = v.InferInput<typeof loadEventsParamsSchema>;

export type UiEvent = ReturnType<typeof prepareEventsForUi>[number];
