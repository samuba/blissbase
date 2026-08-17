import { describe, expect, it } from 'vitest';
import { sortOfferingsForDailyList } from '$lib/rpc/offerings.common';

const mondayNoonUtc = new Date(`2026-08-17T10:00:00.000Z`);
const tuesdayNoonUtc = new Date(`2026-08-18T10:00:00.000Z`);

describe(`sortOfferingsForDailyList`, () => {
	it(`keeps the same order for the same day`, () => {
		const offerings = [
			offering({ id: 1, createdAt: `2026-08-10T08:00:00.000Z` }),
			offering({ id: 2, createdAt: `2026-08-11T08:00:00.000Z` }),
			offering({ id: 3, createdAt: `2026-08-12T08:00:00.000Z` }),
			offering({ id: 4, createdAt: `2026-08-13T08:00:00.000Z` }),
			offering({ id: 5, createdAt: `2026-08-14T08:00:00.000Z` }),
		];

		expect(ids(sortOfferingsForDailyList(offerings, mondayNoonUtc))).toEqual(
			ids(sortOfferingsForDailyList(offerings, mondayNoonUtc)),
		);
		expect(ids(sortOfferingsForDailyList(offerings, mondayNoonUtc))).toEqual(
			ids(sortOfferingsForDailyList([...offerings].reverse(), mondayNoonUtc)),
		);
	});

	it(`uses a different order on the next day`, () => {
		const offerings = [
			offering({ id: 1, createdAt: `2026-08-10T08:00:00.000Z` }),
			offering({ id: 2, createdAt: `2026-08-11T08:00:00.000Z` }),
			offering({ id: 3, createdAt: `2026-08-12T08:00:00.000Z` }),
			offering({ id: 4, createdAt: `2026-08-13T08:00:00.000Z` }),
			offering({ id: 5, createdAt: `2026-08-14T08:00:00.000Z` }),
		];

		expect(ids(sortOfferingsForDailyList(offerings, mondayNoonUtc))).not.toEqual(
			ids(sortOfferingsForDailyList(offerings, tuesdayNoonUtc)),
		);
	});

	it(`puts offerings created today first, newest first`, () => {
		const older = offering({ id: 1, createdAt: `2026-08-16T08:00:00.000Z` });
		const createdThisMorning = offering({ id: 2, createdAt: `2026-08-17T07:00:00.000Z` });
		const createdThisAfternoon = offering({ id: 3, createdAt: `2026-08-17T12:00:00.000Z` });

		expect(ids(sortOfferingsForDailyList([older, createdThisMorning, createdThisAfternoon], mondayNoonUtc))).toEqual([
			3, 2, 1,
		]);
	});

	it(`treats yesterday's creations as part of the daily shuffle`, () => {
		const createdYesterday = offering({ id: 10, createdAt: `2026-08-16T15:00:00.000Z` });
		const createdToday = offering({ id: 11, createdAt: `2026-08-17T08:00:00.000Z` });
		const older = offering({ id: 12, createdAt: `2026-08-01T08:00:00.000Z` });
		const sameIdsIfYesterdayWereOld = [
			offering({ id: 10, createdAt: `2026-07-01T08:00:00.000Z` }),
			offering({ id: 12, createdAt: `2026-08-01T08:00:00.000Z` }),
		];

		const sorted = sortOfferingsForDailyList([older, createdYesterday, createdToday], mondayNoonUtc);

		expect(sorted[0]?.id).toBe(11);
		expect(ids(sorted.slice(1))).toEqual(ids(sortOfferingsForDailyList(sameIdsIfYesterdayWereOld, mondayNoonUtc)));
	});

	it(`uses the Berlin calendar day around midnight`, () => {
		const justBeforeBerlinMidnight = offering({ id: 1, createdAt: `2026-08-16T21:59:00.000Z` });
		const atBerlinMidnight = offering({ id: 2, createdAt: `2026-08-16T22:00:00.000Z` });

		expect(ids(sortOfferingsForDailyList([justBeforeBerlinMidnight, atBerlinMidnight], mondayNoonUtc))).toEqual([
			2, 1,
		]);
	});

	it(`returns an empty array when there are no offerings`, () => {
		expect(sortOfferingsForDailyList([])).toEqual([]);
	});
});

function offering({ id, createdAt }: { id: number; createdAt: string }) {
	return { id, createdAt: new Date(createdAt) };
}

function ids(offerings: { id: number }[]) {
	return offerings.map((item) => item.id);
}
