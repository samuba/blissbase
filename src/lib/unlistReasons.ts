/**
 * Stable short codes written to `events.unlist_reason` when `listed` is set false.
 */
export const unlistReasons = {
	blacklist: `blacklist`,
	whitelist: `whitelist`,
	jevNotConscious: `jev_not_conscious`,
	fakeVenueOnline: `fake_venue_online`,
	unresolvedAddress: `unresolved_address`,
	author: `author`,
} as const;

export type UnlistReason = (typeof unlistReasons)[keyof typeof unlistReasons];
