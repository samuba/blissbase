import { prerender } from '$app/server';
import { db, eq, s } from '$lib/server/db';
import { and, gte, isNotNull, lte } from 'drizzle-orm';
import { extractLatLngBounds, mergeLatLngBounds } from '$lib/server/faqEventRegions';
import { GOOGLE_MAPS_API_KEY } from '$env/static/private';

/**
 * Returns the number of listed events for static UI copy.
 *
 * @example
 * await estimateEventCount()
 */
export const estimateEventCount = prerender(async () => {
	return await db.$count(s.events, eq(s.events.listed, true));
});

/**
 * Returns total and upcoming listed-event counts per FAQ region.
 *
 * @example
 * await getFaqRegionEventCounts()
 */
export const getFaqRegionEventCounts = prerender(async () => {
	const now = new Date();

	const regions = await Promise.all(
		faqEventRegionDefinitions.map(async (region) => {
			const bounds = await resolveRegionBounds({
				queries: region.queries,
				apiKey: GOOGLE_MAPS_API_KEY
			});

			if (!bounds) {
				return {
					key: region.key,
					label: region.label,
					count: 0,
					upcomingCount: 0
				};
			}

			const inRegion = listedEventsInBoundsCondition(bounds);
			const [count, upcomingCount] = await Promise.all([
				db.$count(s.events, inRegion),
				db.$count(s.events, and(inRegion, gte(s.events.startAt, now)))
			]);

			return {
				key: region.key,
				label: region.label,
				count,
				upcomingCount
			};
		})
	);

	return { regions };
});

function listedEventsInBoundsCondition(bounds: LatLngBounds) {
	return and(
		eq(s.events.listed, true),
		isNotNull(s.events.latitude),
		isNotNull(s.events.longitude),
		gte(s.events.latitude, bounds.southWestLat),
		lte(s.events.latitude, bounds.northEastLat),
		gte(s.events.longitude, bounds.southWestLng),
		lte(s.events.longitude, bounds.northEastLng)
	);
}

/**
 * Resolves one or more location queries to a single merged bounding box.
 *
 * @example
 * await resolveRegionBounds({ queries: [`Da Nang, Vietnam`, `Hoi An, Vietnam`], apiKey: `key` })
 */
async function resolveRegionBounds(args: {
	queries: readonly string[];
	apiKey: string;
}) {
	if (!args.apiKey) {
		console.error(`GOOGLE_MAPS_API_KEY is not set. Skipping FAQ region counts.`);
		return null;
	}

	const boundsList = await Promise.all(
		args.queries.map(async (query) => {
			const geometry = await fetchRegionGeometry({
				query,
				apiKey: args.apiKey
			});

			return extractLatLngBounds(geometry);
		})
	);

	return mergeLatLngBounds(
		boundsList.filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))
	);
}

/**
 * Fetches Google geocode geometry for a region name.
 *
 * @example
 * await fetchRegionGeometry({ query: `Bali, Indonesia`, apiKey: `key` })
 */
async function fetchRegionGeometry(args: {
	query: string;
	apiKey: string;
}) {
	try {
		const url = new URL(`https://maps.googleapis.com/maps/api/geocode/json`);
		url.searchParams.set(`address`, args.query);
		url.searchParams.set(`key`, args.apiKey);
		url.searchParams.set(`language`, `en`);

		const response = await fetch(url);
		if (!response.ok) {
			console.error(`FAQ region geocoding failed for "${args.query}" with status ${response.status}`);
			return null;
		}

		const data = await response.json() as GoogleGeocodeResponse;
		if (data.status !== `OK`) {
			console.error(`FAQ region geocoding failed for "${args.query}": ${data.status}`);
			return null;
		}

		return data.results?.[0]?.geometry ?? null;
	} catch (error) {
		console.error(
			`FAQ region geocoding errored for "${args.query}":`,
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

const faqEventRegionDefinitions = [
	{
		key: `germany`,
		label: `Deutschland`,
		queries: [`Germany`]
	},
	{
		key: `austria`,
		label: `Österreich`,
		queries: [`Austria`]
	},
	{
		key: `switzerland`,
		label: `Schweiz`,
		queries: [`Switzerland`]
	},
	{
		key: `bali`,
		label: `Bali`,
		queries: [`Bali, Indonesia`]
	},
	{
		key: `danang-hoi-an`,
		label: `Da Nang / Hoi An`,
		queries: [`Da Nang, Vietnam`, `Hoi An, Vietnam`]
	}
] as const;

type LatLngBounds = {
	southWestLat: number;
	southWestLng: number;
	northEastLat: number;
	northEastLng: number;
};

type GoogleGeocodeResponse = {
	status: string;
	results?: {
		geometry?: {
			bounds?: {
				southwest: { lat: number; lng: number };
				northeast: { lat: number; lng: number };
			};
			viewport?: {
				southwest: { lat: number; lng: number };
				northeast: { lat: number; lng: number };
			};
		};
	}[];
};
