import { parseDate } from "@internationalized/date";
import { formatAddress } from "$lib/common";
import { absoluteUrl, routes } from "$lib/routes";
import { fetchEvents, prepareEventsForUi } from "$lib/server/events";

/** Same city ids the Soulspots snippet used, so existing `location-id` attributes keep working. */
export const breathworkEmbedCities = [
	{ id: 195, name: `Berlin`, country: `Deutschland`, lat: 52.52, lng: 13.405 },
	{ id: 196, name: `Hamburg`, country: `Deutschland`, lat: 53.5511, lng: 9.9937 },
	{ id: 197, name: `München`, country: `Deutschland`, lat: 48.1351, lng: 11.582 },
	{ id: 198, name: `Köln`, country: `Deutschland`, lat: 50.9375, lng: 6.9603 },
	{ id: 199, name: `Frankfurt`, country: `Deutschland`, lat: 50.1109, lng: 8.6821 },
	{ id: 200, name: `Hannover`, country: `Deutschland`, lat: 52.3759, lng: 9.732 },
	{ id: 201, name: `Stuttgart`, country: `Deutschland`, lat: 48.7758, lng: 9.1829 },
	{ id: 202, name: `Düsseldorf`, country: `Deutschland`, lat: 51.2277, lng: 6.7735 },
	{ id: 203, name: `Wien`, country: `Österreich`, lat: 48.2082, lng: 16.3738 },
	{ id: 204, name: `Graz`, country: `Österreich`, lat: 47.0707, lng: 15.4395 },
	{ id: 206, name: `Zürich`, country: `Schweiz`, lat: 47.3769, lng: 8.5417 },
	{ id: 205, name: `Bern`, country: `Schweiz`, lat: 46.948, lng: 7.4474 },
] as const;

const CITY_RADIUS_KM = `50`;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;

/**
 * Searches listed Blissbase breathwork events around one of the embed cities.
 * Uses the same date, distance, and tag filters as the rest of the app.
 */
export async function searchBreathworkEmbedEvents(args: {
	locationId?: unknown;
	city?: unknown;
	start?: unknown;
	end?: unknown;
	limit?: unknown;
	cursor?: unknown;
}) {
	const city = resolveBreathworkEmbedCity({ locationId: args.locationId, city: args.city });
	if (!city) return emptyEmbedResult();

	const range = embedDateRange({ start: args.start, end: args.end });
	if (!range) return emptyEmbedResult();

	const limit = clampLimit(args.limit);
	const offset = parseCursor(args.cursor);

	try {
		const result = await fetchEvents({
			plzCity: city.name,
			lat: city.lat,
			lng: city.lng,
			distance: CITY_RADIUS_KM,
			startDate: range.start,
			endDate: range.end,
			categorySlugs: [`breathwork`],
			limit,
			offset,
			page: 1,
			sortBy: `time`,
			sortOrder: `asc`,
		});

		const results: BreathworkEmbedEvent[] = [];
		for (const event of prepareEventsForUi(result.events)) {
			const mapped = toBreathworkEmbedEvent(event);
			if (!mapped) continue;
			results.push(mapped);
		}

		const nextOffset = offset + result.events.length;
		const total = Number(result.pagination.totalEvents);
		const nextCursor = Number.isFinite(total) && nextOffset < total ? String(nextOffset) : null;
		return { results, nextCursor };
	} catch (error) {
		console.error(`breathwork embed search failed`, error);
		return emptyEmbedResult();
	}
}

export function breathworkEmbedQueryFromBody(body: unknown) {
	const record = isRecord(body) ? body : {};
	return {
		locationId: record.locationId,
		city: record.city,
		start: record.start,
		end: record.end,
		limit: record.limit,
		cursor: record.cursor,
	};
}

export function resolveBreathworkEmbedCity(args: { locationId?: unknown; city?: unknown }) {
	const id = finiteNumber(args.locationId);
	if (id != null && Number.isInteger(id)) {
		const byId = breathworkEmbedCities.find((city) => city.id === id);
		if (byId) return byId;
	}

	if (typeof args.city !== `string`) return null;
	const name = args.city.trim().toLocaleLowerCase(`de`);
	if (!name) return null;
	return breathworkEmbedCities.find((city) => city.name.toLocaleLowerCase(`de`) === name) ?? null;
}

export function toBreathworkEmbedEvent(event: {
	id?: number | null;
	name?: string | null;
	slug?: string | null;
	startAt?: Date | string | null;
	endAt?: Date | string | null;
	imageUrls?: string[] | null;
	address?: string[] | null;
}) {
	try {
		const startDate = toIso(event.startAt);
		if (!startDate || !event.name || !event.slug || event.id == null) return null;
		const address = event.address ?? [];
		return {
			id: event.id,
			name: event.name,
			startDate,
			endDate: toIso(event.endAt),
			url: absoluteUrl(routes.eventDetails(event.slug)),
			imageUrl: publicImageUrl(event.imageUrls?.[0]),
			venue: formatAddress(address) || address.filter(Boolean).join(`, `),
		} satisfies BreathworkEmbedEvent;
	} catch (error) {
		console.error(`breathwork embed skipped event`, error);
		return null;
	}
}

function embedDateRange(args: { start?: unknown; end?: unknown }) {
	const start = isoDate(args.start);
	const end = isoDate(args.end);
	if (!start || !end) return null;
	if (start <= end) return { start, end };
	return { start: end, end: start };
}

function isoDate(value: unknown) {
	if (typeof value !== `string` || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	try {
		parseDate(value);
		return value;
	} catch {
		return null;
	}
}

function clampLimit(value: unknown) {
	const limit = finiteNumber(value);
	if (limit == null || limit <= 0) return DEFAULT_LIMIT;
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function parseCursor(value: unknown) {
	if (typeof value !== `string` || !/^\d+$/.test(value)) return 0;
	return Number(value);
}

function finiteNumber(value: unknown) {
	if (typeof value === `number` && Number.isFinite(value)) return value;
	if (typeof value !== `string` || !value.trim()) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	return parsed;
}

function toIso(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function publicImageUrl(value?: string | null) {
	if (!value) return ``;
	if (value.startsWith(`/`)) return absoluteUrl(value);
	try {
		const url = new URL(value);
		if (url.protocol !== `https:` && url.protocol !== `http:`) return ``;
		return url.toString();
	} catch {
		return ``;
	}
}

function emptyEmbedResult() {
	return { results: [], nextCursor: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === `object`;
}

type BreathworkEmbedEvent = {
	id: number;
	name: string;
	startDate: string;
	endDate: string | null;
	url: string;
	imageUrl: string;
	venue: string;
};
