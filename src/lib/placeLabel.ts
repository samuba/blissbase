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
