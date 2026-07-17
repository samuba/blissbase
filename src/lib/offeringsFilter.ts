import { stripHtml, trimAllWhitespaces } from '$lib/common';
import type { FilterCookieData } from '$lib/cookie-utils';
import type { OfferingFormat } from '$lib/rpc/offerings.common';
import { hasValidCoordinates, isWithinDistanceKm, sanitizeLocationParams } from '$lib/locationFilter';

export type OfferingsFilter = {
	location: string | null;
	distance: string | null;
	lat: number | null;
	lng: number | null;
	searchTerm: string | null;
	includeOnline: boolean;
};

const OFFERINGS_FILTER_URL_KEYS = [
	`location`,
	`plzCity`,
	`distance`,
	`lat`,
	`lng`,
	`searchTerm`,
	`includeOnline`,
	`onlineOnly`,
] as const;

export function parseOfferingsFilterFromUrl(url: URL): OfferingsFilter {
	const latParam = url.searchParams.get(`lat`);
	const lngParam = url.searchParams.get(`lng`);
	const searchTerm = url.searchParams.get(`searchTerm`)?.trim() || null;

	const sanitized = sanitizeLocationParams({
		plzCity: url.searchParams.get(`location`) ?? url.searchParams.get(`plzCity`),
		distance: url.searchParams.get(`distance`),
		lat: latParam != null ? Number(latParam) : null,
		lng: lngParam != null ? Number(lngParam) : null,
	});

	const includeOnlineParam = url.searchParams.get(`includeOnline`) ?? url.searchParams.get(`onlineOnly`);

	return {
		location: sanitized.plzCity ?? null,
		distance: sanitized.distance ?? null,
		lat: sanitized.lat ?? null,
		lng: sanitized.lng ?? null,
		searchTerm,
		includeOnline: includeOnlineParam === `1` || includeOnlineParam === `true`,
	};
}

export function hasOfferingsLocationParams(filter: OfferingsFilter) {
	return Boolean(
		filter.location?.trim() ||
		filter.distance ||
		(filter.lat != null && filter.lng != null),
	);
}

export function hasOfferingsFilterParams(filter: OfferingsFilter) {
	return hasOfferingsLocationParams(filter) || Boolean(filter.searchTerm?.trim()) || filter.includeOnline;
}

/** True when the URL explicitly carries any offerings filter query key. */
export function hasOfferingsFilterUrlParams(url: URL) {
	return OFFERINGS_FILTER_URL_KEYS.some((key) => url.searchParams.has(key));
}

export function offeringsFilterFromCookie(cookie: FilterCookieData | null | undefined): OfferingsFilter {
	return {
		location: cookie?.plzCity ?? null,
		distance: cookie?.distance ?? null,
		lat: cookie?.lat ?? null,
		lng: cookie?.lng ?? null,
		searchTerm: cookie?.offeringsSearchTerm ?? null,
		includeOnline: cookie?.includeOnline === true,
	};
}

export function buildOfferingsFilterSearchParams(filter: OfferingsFilter) {
	const params = new URLSearchParams();

	if (filter.location?.trim()) params.set(`location`, filter.location.trim());
	if (filter.distance) params.set(`distance`, filter.distance);
	if (filter.lat != null) params.set(`lat`, String(filter.lat));
	if (filter.lng != null) params.set(`lng`, String(filter.lng));
	if (filter.searchTerm?.trim()) params.set(`searchTerm`, filter.searchTerm.trim());
	if (filter.includeOnline) params.set(`includeOnline`, `1`);

	return params;
}

export function filterOfferingsBySearchTerm<T extends {
	title: string;
	descriptionHtml?: string | null;
	profile: { displayName?: string | null };
}>(args: { offerings: T[]; searchTerm: string | null }) {
	const normalizedSearchTerm = args.searchTerm?.trim().toLocaleLowerCase();
	if (!normalizedSearchTerm) return args.offerings;

	return args.offerings.filter((offering) => {
		const title = offering.title.toLocaleLowerCase();
		const description = (trimAllWhitespaces(stripHtml(offering.descriptionHtml ?? ``)) ?? ``).toLocaleLowerCase();
		const host = offering.profile.displayName?.toLocaleLowerCase();

		return title.includes(normalizedSearchTerm) || description.includes(normalizedSearchTerm) || host?.includes(normalizedSearchTerm);
	});
}

export function shouldIncludeOfferingInLocationFilter(args: {
	format: OfferingFormat;
	includeOnline: boolean;
	profileLatitude: number | null | undefined;
	profileLongitude: number | null | undefined;
	filterCoords: { lat: number; lng: number };
	distanceKm: number;
}) {
	if (args.includeOnline && isOfferingAvailableOnline(args.format)) return true;
	if (!isOfflineOffering(args.format)) return false;
	if (!hasValidCoordinates({ lat: args.profileLatitude, lng: args.profileLongitude })) return false;

	return isWithinDistanceKm({
		fromLat: args.filterCoords.lat,
		fromLng: args.filterCoords.lng,
		toLat: args.profileLatitude!,
		toLng: args.profileLongitude!,
		distanceKm: args.distanceKm,
	});
}

export function isOfferingAvailableOnline(format: OfferingFormat) {
	return format === `online` || format === `offline+online`;
}

function isOfflineOffering(format: OfferingFormat) {
	return format === `offline` || format === `offline+online`;
}

export function filterOfferingsByIncludeOnline<T extends { format: OfferingFormat }>(args: {
	offerings: T[];
	includeOnline: boolean;
}) {
	if (args.includeOnline) return args.offerings;
	return args.offerings.filter((offering) => offering.format !== `online`);
}
