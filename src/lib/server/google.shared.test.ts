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

describe(`geocodeAddressCached`, () => {
	afterEach(async () => {
		await db.delete(s.geocodeCache);
		vi.unstubAllGlobals();
	});

	it(`caches a ZERO_RESULTS miss`, async () => {
		vi.stubGlobal(`fetch`, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: `ZERO_RESULTS`, results: [] }) }));
		const { geocodeAddressCached } = createGoogleCacheApi(db);

		expect(await geocodeAddressCached({ addressLines: [`Nowhere 1`], apiKey: `test-key` })).toBeNull();
		expect(await db.query.geocodeCache.findFirst({ where: eq(s.geocodeCache.address, `Nowhere 1`) })).toMatchObject({ latitude: null });
	});

	it(`does not cache a transient failure, so the next run retries`, async () => {
		vi.stubGlobal(`fetch`, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: `OVER_QUERY_LIMIT` }) }));
		expect(await createGoogleCacheApi(db).geocodeAddressCached({ addressLines: [`Studio 1`], apiKey: `test-key` })).toBeNull();
		expect(await db.query.geocodeCache.findFirst({ where: eq(s.geocodeCache.address, `Studio 1`) })).toBeUndefined();

		vi.stubGlobal(`fetch`, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: `OK`, results: [{ geometry: { location: { lat: 1, lng: 2 } } }] }) }));
		expect(await createGoogleCacheApi(db).geocodeAddressCached({ addressLines: [`Studio 1`], apiKey: `test-key` })).toMatchObject({ lat: 1, lng: 2 });
	});

	it(`does not cache when the API key is missing`, async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal(`fetch`, fetchMock);
		expect(await createGoogleCacheApi(db).geocodeAddressCached({ addressLines: [`Studio 2`], apiKey: `` })).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await db.query.geocodeCache.findFirst({ where: eq(s.geocodeCache.address, `Studio 2`) })).toBeUndefined();
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
