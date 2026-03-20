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
		tagIds: [] as string[],
		price: ``,
		address: ``,
		startAt: formatDateForLocalInput(t),
		endAt: ``,
		timeZone: args.timeZone,
		isOnline: false,
		isNotListed: false,
		contact: ``,
		contactMethod: `none`,
		images: [] as File[]
	};
}
