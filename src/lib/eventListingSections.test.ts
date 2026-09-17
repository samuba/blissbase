import { describe, expect, it } from 'vitest';
import { buildEventListingItems, getEventListingSection } from './eventListingSections';

function atLocal(args: { year: number; month: number; day: number; hour?: number }) {
	return new Date(args.year, args.month, args.day, args.hour ?? 18, 0, 0);
}

describe(`getEventListingSection`, () => {
	it(`groups Wednesday events into today, tomorrow, Übermorgen, rest of week, and next week`, () => {
		const now = atLocal({ year: 2025, month: 5, day: 4, hour: 12 });

		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 4 }), now })).toBe(`today`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 3 }), now })).toBe(`today`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 5 }), now })).toBe(`tomorrow`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 6 }), now })).toBe(`dayAfterTomorrow`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 7 }), now })).toBe(`restOfWeek`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 8 }), now })).toBe(`restOfWeek`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 9 }), now })).toBe(`nextWeek`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 15 }), now })).toBe(`nextWeek`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 16 }), now })).toBe(`later`);
	});

	it(`keeps Übermorgen when that day is already next week`, () => {
		const now = atLocal({ year: 2025, month: 5, day: 7, hour: 12 });

		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 8 }), now })).toBe(`tomorrow`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 9 }), now })).toBe(`dayAfterTomorrow`);
		expect(getEventListingSection({ startAt: atLocal({ year: 2025, month: 5, day: 10 }), now })).toBe(`nextWeek`);
	});
});

describe(`buildEventListingItems`, () => {
	const now = atLocal({ year: 2025, month: 5, day: 4, hour: 12 });

	it(`inserts Morgen, Übermorgen, Später diese Woche, Nächste Woche, and Später dividers`, () => {
		const events = [
			{ id: 1, startAt: atLocal({ year: 2025, month: 5, day: 4, hour: 16 }) },
			{ id: 2, startAt: atLocal({ year: 2025, month: 5, day: 4, hour: 20 }) },
			{ id: 3, startAt: atLocal({ year: 2025, month: 5, day: 5 }) },
			{ id: 4, startAt: atLocal({ year: 2025, month: 5, day: 6 }) },
			{ id: 5, startAt: atLocal({ year: 2025, month: 5, day: 7 }) },
			{ id: 6, startAt: atLocal({ year: 2025, month: 5, day: 9 }) },
			{ id: 7, startAt: atLocal({ year: 2025, month: 5, day: 16 }) },
		];

		expect(buildEventListingItems({ events, now, showDividers: true })).toEqual([
			{ kind: `event`, event: events[0] },
			{ kind: `event`, event: events[1] },
			{ kind: `divider`, section: `tomorrow` },
			{ kind: `event`, event: events[2] },
			{ kind: `divider`, section: `dayAfterTomorrow` },
			{ kind: `event`, event: events[3] },
			{ kind: `divider`, section: `restOfWeek` },
			{ kind: `event`, event: events[4] },
			{ kind: `divider`, section: `nextWeek` },
			{ kind: `event`, event: events[5] },
			{ kind: `divider`, section: `later` },
			{ kind: `event`, event: events[6] },
		]);
	});

	it(`skips a divider when that day has no events`, () => {
		const events = [
			{ id: 1, startAt: atLocal({ year: 2025, month: 5, day: 4 }) },
			{ id: 2, startAt: atLocal({ year: 2025, month: 5, day: 6 }) },
			{ id: 3, startAt: atLocal({ year: 2025, month: 5, day: 9 }) },
		];

		expect(buildEventListingItems({ events, now, showDividers: true })).toEqual([
			{ kind: `event`, event: events[0] },
			{ kind: `divider`, section: `dayAfterTomorrow` },
			{ kind: `event`, event: events[1] },
			{ kind: `divider`, section: `nextWeek` },
			{ kind: `event`, event: events[2] },
		]);
	});

	it(`does not put a divider before the first event`, () => {
		const events = [{ id: 1, startAt: atLocal({ year: 2025, month: 5, day: 5 }) }];

		expect(buildEventListingItems({ events, now, showDividers: true })).toEqual([
			{ kind: `event`, event: events[0] },
		]);
	});

	it(`returns only events when dividers are disabled`, () => {
		const events = [
			{ id: 1, startAt: atLocal({ year: 2025, month: 5, day: 4 }) },
			{ id: 2, startAt: atLocal({ year: 2025, month: 5, day: 5 }) },
		];

		expect(buildEventListingItems({ events, now, showDividers: false })).toEqual([
			{ kind: `event`, event: events[0] },
			{ kind: `event`, event: events[1] },
		]);
	});
});
