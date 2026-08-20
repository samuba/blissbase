import { formatDateForLocalInput } from '$lib/events.remote.common';

/**
 * Baseline field values for the create-event form before AI prefill or user edits.
 *
 * @example
 * getDefaultCreateEventFieldBase({ timeZone: `Europe/Berlin` });
 */
export function getDefaultCreateEventFieldBase(args: { timeZone: string }) {
	const t = new Date();
	t.setDate(t.getDate() + 1);
	t.setHours(12, 0, 0, 0);
	return {
		name: ``,
		description: ``,
		tagSlugs: [] as string[],
		price: ``,
		address: ``,
		addressNote: ``,
		latitude: ``,
		longitude: ``,
		startAt: formatDateForLocalInput(t),
		endAt: ``,
		timeZone: args.timeZone,
		isOnline: false,
		isNotListed: false,
		contact: ``,
		contactMethod: `none`,
		images: [] as File[],
		email: ``,
		authToken: ``,
	};
}

/**
 * Keeps the current pin and address note unless AI prefill changed the address.
 *
 * @example
 * applyCreateEventLocationPrefill({
 *   base: { address: `Berlin`, addressNote: `3. Stock`, latitude: `52.52`, longitude: `13.405` },
 *   prefillAddress: `Berlin`,
 * })
 */
export function applyCreateEventLocationPrefill(args: {
	base: { address: string; addressNote: string; latitude: string; longitude: string };
	prefillAddress?: string;
}) {
	const address = args.prefillAddress || args.base.address;
	const addressChanged = Boolean(args.prefillAddress) && args.prefillAddress !== args.base.address;
	if (!addressChanged) {
		return {
			address,
			addressNote: args.base.addressNote,
			latitude: args.base.latitude,
			longitude: args.base.longitude,
		};
	}

	return {
		address,
		addressNote: ``,
		latitude: ``,
		longitude: ``,
	};
}
