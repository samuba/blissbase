export const ALLOWED_DISTANCE_VALUES = [
	`5`,
	`10`,
	`15`,
	`30`,
	`50`,
	`100`,
	`150`,
	`300`,
	`500`,
	`9000`
] as const;

export type AllowedDistance = (typeof ALLOWED_DISTANCE_VALUES)[number];

export function isValidLatitude(lat: number | null | undefined) {
	if (lat == null) return false;
	return !isNaN(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number | null | undefined) {
	if (lng == null) return false;
	return !isNaN(lng) && lng >= -180 && lng <= 180;
}

export function isValidDistance(distance: string | null | undefined) {
	if (distance == null || distance === ``) return true;
	return ALLOWED_DISTANCE_VALUES.includes(distance as AllowedDistance);
}

export function hasValidCoordinates(args: {
	lat: number | null | undefined;
	lng: number | null | undefined;
}) {
	return isValidLatitude(args.lat) && isValidLongitude(args.lng);
}

/**
 * True when both pairs are valid and match at five decimal places (~1.1m).
 *
 * @example
 * coordinatesMatch({ a: { lat: 52.52, lng: 13.405 }, b: { lat: 52.520001, lng: 13.405002 } })
 */
export function coordinatesMatch(args: {
	a: { lat?: number | null; lng?: number | null };
	b: { lat?: number | null; lng?: number | null };
}) {
	if (!hasValidCoordinates({ lat: args.a.lat, lng: args.a.lng })) return false;
	if (!hasValidCoordinates({ lat: args.b.lat, lng: args.b.lng })) return false;
	return args.a.lat!.toFixed(5) === Number(args.b.lat).toFixed(5)
		&& args.a.lng!.toFixed(5) === Number(args.b.lng).toFixed(5);
}

export function getDistanceInKm(args: {
	fromLat: number;
	fromLng: number;
	toLat: number;
	toLng: number;
}) {
	const earthRadiusKm = 6371;
	const deltaLat = toRadians(args.toLat - args.fromLat);
	const deltaLng = toRadians(args.toLng - args.fromLng);
	const fromLat = toRadians(args.fromLat);
	const toLat = toRadians(args.toLat);
	const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return earthRadiusKm * c;
}

export function isWithinDistanceKm(args: {
	fromLat: number;
	fromLng: number;
	toLat: number;
	toLng: number;
	distanceKm: number;
}) {
	return getDistanceInKm(args) <= args.distanceKm;
}

function toRadians(value: number) {
	return value * (Math.PI / 180);
}

export function sanitizeLocationParams<T extends {
	location?: string | null;
	plzCity?: string | null;
	distance?: string | null;
	lat?: number | null;
	lng?: number | null;
}>(params: T): T {
	const sanitized = { ...params };

	if (!isValidDistance(sanitized.distance)) {
		sanitized.distance = null;
	}

	const lat = sanitized.lat != null ? Number(sanitized.lat) : null;
	const lng = sanitized.lng != null ? Number(sanitized.lng) : null;

	if (!hasValidCoordinates({ lat, lng })) {
		sanitized.lat = null;
		sanitized.lng = null;
	} else {
		sanitized.lat = lat;
		sanitized.lng = lng;
	}

	return sanitized;
}

/** Coarsen coordinates for analytics (~11 km precision at equator). */
export function coarseLatLngForAnalytics(args: {
	lat?: number | null;
	lng?: number | null;
}) {
	if (!hasValidCoordinates({ lat: args.lat, lng: args.lng })) {
		return { lat: undefined, lng: undefined };
	}

	return {
		lat: Math.round(args.lat! * 10) / 10,
		lng: Math.round(args.lng! * 10) / 10
	};
}
