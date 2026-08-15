import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, eq, s } from '$lib/server/db';
import { createGoogleCacheApi, timezoneCacheKey } from './google.shared';

describe(`timezoneCacheKey`, () => {
	it(`rounds coordinates to five decimals`, () => {
		expect(timezoneCacheKey({ lat: 52.52, lng: 13.405 })).toBe(`coord:52.52000,13.40500`);
		expect(timezoneCacheKey({ lat: 52.520001, lng: 13.405002 })).toBe(`coord:52.52000,13.40500`);
	});
});

describe(`getTimezoneForCoordinatesCached`, () => {
	afterEach(async () => {
		await db.delete(s.geocodeCache);
		vi.unstubAllGlobals();
	});

	it(`calls the timezone API once and reuses the cached value`, async () => {
		const fetchMock = mockTimezoneFetch(`Europe/Berlin`);
		const { getTimezoneForCoordinatesCached } = createGoogleCacheApi(db);
		const args = { lat: 52.52, lng: 13.405, apiKey: `test-key` };

		expect(await getTimezoneForCoordinatesCached(args)).toBe(`Europe/Berlin`);
		expect(await getTimezoneForCoordinatesCached(args)).toBe(`Europe/Berlin`);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it(`reuses the db cache across API instances for the same rounded coordinates`, async () => {
		const fetchMock = mockTimezoneFetch(`Europe/Berlin`);
		const first = createGoogleCacheApi(db);
		expect(await first.getTimezoneForCoordinatesCached({
			lat: 52.52,
			lng: 13.405,
			apiKey: `test-key`
		})).toBe(`Europe/Berlin`);

		const second = createGoogleCacheApi(db);
		expect(await second.getTimezoneForCoordinatesCached({
			lat: 52.520001,
			lng: 13.405002,
			apiKey: `test-key`
		})).toBe(`Europe/Berlin`);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const cached = await db.query.geocodeCache.findFirst({
			where: eq(s.geocodeCache.address, timezoneCacheKey({ lat: 52.52, lng: 13.405 }))
		});
		expect(cached?.timezone).toBe(`Europe/Berlin`);
	});

	it(`looks up distinct coordinates separately`, async () => {
		const fetchMock = mockTimezoneFetch(`Europe/Berlin`);
		const { getTimezoneForCoordinatesCached } = createGoogleCacheApi(db);

		await getTimezoneForCoordinatesCached({ lat: 52.52, lng: 13.405, apiKey: `test-key` });
		await getTimezoneForCoordinatesCached({ lat: 48.137, lng: 11.575, apiKey: `test-key` });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

function mockTimezoneFetch(timeZoneId: string) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({ status: `OK`, timeZoneId })
	});
	vi.stubGlobal(`fetch`, fetchMock);
	return fetchMock;
}
