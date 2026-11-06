import { getDistanceInKm } from '$lib/locationFilter';

/**
 * Coastal Hội An. The An Giang commune of the same name is a different place.
 * Bare queries such as `Hoi An` or `Hoyan` mean this city.
 */
export const COASTAL_HOI_AN = {
	label: `Hội An`,
	lat: 15.8801,
	lng: 108.338,
};

const OTHER_HOI_AN_DISTANCE_KM = 150;

/**
 * Keeps a distinguishing region from the formatted address.
 * `Hội An` plus `Hội An, An Giang, Vietnam` stays `Hội An, An Giang, Vietnam`.
 *
 * @example
 * disambiguatedPlaceLabel({ displayName: `Hoi An`, formattedAddress: `Hội An, An Giang, Vietnam` })
 */
export function disambiguatedPlaceLabel(args: { displayName: string; formattedAddress: string }) {
	const displayName = args.displayName.trim();
	const formattedAddress = args.formattedAddress.trim();
	if (!formattedAddress) return displayName;
	if (!displayName || formattedAddressHasPlaceName({ formattedAddress, displayName })) return formattedAddress;
	return `${displayName}, ${formattedAddress}`;
}

/**
 * True when both labels name the same place and neither adds a different region.
 * Country tokens are ignored, so `Hoi An, VN` matches `Hội An`.
 * `Hội An, An Giang` does not match `Hoi An`.
 *
 * @example
 * sameDeclaredPlace({ label: `Hoi An, VN`, search: `Hội An` })
 */
export function sameDeclaredPlace(args: { label: string | null | undefined; search: string | null | undefined }) {
	const labelParts = new Set(placeParts(args.label));
	const searchParts = new Set(placeParts(args.search));
	if (!labelParts.size || labelParts.size !== searchParts.size) return false;

	for (const part of labelParts) {
		if (!searchParts.has(part)) return false;
	}
	return true;
}

/**
 * True for a bare Hội An query, including `Hoyan` and `Hoi An, VN`.
 * An explicit An Giang or Chợ Mới query stays the other place.
 *
 * @example
 * wantsCoastalHoiAn(`Hoyan`)
 */
export function wantsCoastalHoiAn(query: string | null | undefined) {
	if (!query?.trim() || asksForOtherHoiAn(query)) return false;
	return isBareHoiAnName(query);
}

/**
 * True when the text names the Mekong commune rather than the coastal city.
 *
 * @example
 * asksForOtherHoiAn(`Hội An, An Giang`)
 */
export function asksForOtherHoiAn(value: string | null | undefined) {
	const folded = foldPlaceText(value ?? ``);
	return folded.includes(`an giang`) || folded.includes(`cho moi`);
}

/**
 * Drops the An Giang Hội An commune from autocomplete. Coastal Hội An stays.
 * Other An Giang places, such as Long Xuyên, stay too.
 *
 * @example
 * omitOtherHoiAnSuggestions([{ text: `Hội An, An Giang, Vietnam` }, { text: `Hội An, Đà Nẵng, Vietnam` }])
 */
export function omitOtherHoiAnSuggestions<T extends { text: string }>(suggestions: T[]) {
	return suggestions.filter((suggestion) => !isOtherHoiAnSuggestion(suggestion.text));
}

/**
 * True when a suggestion names the Mekong commune called Hội An.
 *
 * @example
 * isOtherHoiAnSuggestion(`Hội An, Chợ Mới, An Giang, Vietnam`)
 */
export function isOtherHoiAnSuggestion(text: string | null | undefined) {
	if (!asksForOtherHoiAn(text)) return false;
	return mentionsHoiAn(text);
}

/**
 * True when the text mentions Hội An, Hoyan, or Hoian, with or without a region.
 *
 * @example
 * mentionsHoiAn(`Hội An, An Giang`)
 */
export function mentionsHoiAn(value: string | null | undefined) {
	const folded = foldPlaceText(value ?? ``);
	return folded.includes(`hoi an`) || folded.includes(`hoian`) || folded.includes(`hoyan`);
}

/**
 * Rewrites an An Giang Hội An pin to the coastal city.
 * A coastal venue such as The Nam Hai is left alone.
 *
 * @example
 * preferCoastalHoiAnPlace({ query: `Hoi An`, displayName: `Hoi An, VN`, formattedAddress: `Hoi An, VN`, latitude: 10.3838, longitude: 105.489, suggestionText: `Hoi An, Vietnam` })
 */
export function preferCoastalHoiAnPlace<T extends {
	displayName: string;
	formattedAddress: string;
	latitude: number;
	longitude: number;
}>(args: T & { query?: string | null; suggestionText?: string | null }): T {
	if (!wantsCoastalHoiAn(args.query) && !isBareHoiAnName(args.displayName) && !isOtherHoiAnSuggestion(args.suggestionText)) return args;
	if (!isOtherHoiAnPin(args)) return args;

	return {
		...args,
		displayName: COASTAL_HOI_AN.label,
		formattedAddress: COASTAL_HOI_AN.label,
		latitude: COASTAL_HOI_AN.lat,
		longitude: COASTAL_HOI_AN.lng,
	};
}

/**
 * Geocoding `Hoi An` to the An Giang commune is the same mistake.
 * Results already near the coast, and explicit An Giang queries, stay as they are.
 *
 * @example
 * preferCoastalHoiAnCoordinates({ query: `Hoyan`, lat: 10.3838, lng: 105.489 })
 */
export function preferCoastalHoiAnCoordinates(args: { query: string; lat: number; lng: number }) {
	if (!wantsCoastalHoiAn(args.query)) return { lat: args.lat, lng: args.lng };
	if (!isFarFromCoastalHoiAn(args)) return { lat: args.lat, lng: args.lng };
	return { lat: COASTAL_HOI_AN.lat, lng: COASTAL_HOI_AN.lng };
}

function isOtherHoiAnPin(args: { displayName: string; formattedAddress: string; latitude: number; longitude: number }) {
	if (!mentionsHoiAn(args.displayName) && !mentionsHoiAn(args.formattedAddress)) return false;
	return isFarFromCoastalHoiAn(args);
}

function isFarFromCoastalHoiAn(args: { latitude?: number; longitude?: number; lat?: number; lng?: number }) {
	const latitude = args.latitude ?? args.lat;
	const longitude = args.longitude ?? args.lng;
	if (latitude == null || longitude == null) return false;
	return getDistanceInKm({
		fromLat: COASTAL_HOI_AN.lat,
		fromLng: COASTAL_HOI_AN.lng,
		toLat: latitude,
		toLng: longitude,
	}) > OTHER_HOI_AN_DISTANCE_KM;
}

function isBareHoiAnName(value: string | null | undefined) {
	const folded = foldPlaceText(value ?? ``);
	if (folded === `hoi an` || folded === `hoian` || folded === `hoyan`) return true;
	const parts = placeParts(value);
	return parts.length === 1 && (parts[0] === `hoi an` || parts[0] === `hoian` || parts[0] === `hoyan`);
}

function formattedAddressHasPlaceName(args: { formattedAddress: string; displayName: string }) {
	const name = foldPlaceText(args.displayName);
	if (!name) return false;
	if (foldPlaceText(args.formattedAddress) === name) return true;
	return args.formattedAddress.split(`,`).some((part) => foldPlaceText(part) === name);
}

function placeParts(value: string | null | undefined) {
	if (!value?.trim()) return [];

	const parts: string[] = [];
	for (const rawPart of value.split(`,`)) {
		const part = stripAdminPrefix(foldPlaceText(rawPart));
		if (!part || COUNTRY_PARTS.has(part)) continue;
		parts.push(part);
	}
	return parts;
}

function stripAdminPrefix(part: string) {
	let rest = part;
	let stripped = true;
	while (rest && stripped) {
		stripped = false;
		for (const prefix of ADMIN_PREFIXES) {
			if (rest === prefix) return ``;
			if (!rest.startsWith(`${prefix} `)) continue;
			rest = rest.slice(prefix.length + 1).trim();
			stripped = true;
			break;
		}
	}
	return rest;
}

function foldPlaceText(value: string) {
	return value
		.trim()
		.normalize(`NFD`)
		.replace(/[\u0300-\u036f]/g, ``)
		.replace(/đ/gi, `d`)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ` `)
		.trim();
}

const ADMIN_PREFIXES = [`thanh pho`, `thi xa`, `tp`, `xa`, `phuong`, `quan`, `huyen`, `tinh`];

const COUNTRY_PARTS = new Set([
	`vn`,
	`vietnam`,
	`viet nam`,
	`de`,
	`deutschland`,
	`germany`,
	`at`,
	`osterreich`,
	`austria`,
	`ch`,
	`schweiz`,
	`switzerland`,
	`suisse`,
	`svizzera`,
	`us`,
	`usa`,
	`united states`,
	`united states of america`,
	`uk`,
	`gb`,
	`united kingdom`,
	`th`,
	`thailand`,
	`id`,
	`indonesia`,
	`fr`,
	`france`,
	`es`,
	`spain`,
	`spanien`,
	`it`,
	`italy`,
	`italien`,
	`pt`,
	`portugal`,
	`nl`,
	`netherlands`,
	`niederlande`,
	`au`,
	`australia`,
	`nz`,
	`new zealand`,
	`ca`,
	`canada`,
	`in`,
	`india`,
	`sg`,
	`singapore`,
	`my`,
	`malaysia`,
	`ph`,
	`philippines`,
	`mx`,
	`mexico`,
	`br`,
	`brazil`,
	`jp`,
	`japan`,
	`kr`,
	`korea`,
	`south korea`,
]);
