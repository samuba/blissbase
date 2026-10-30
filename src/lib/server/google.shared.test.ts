import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, eq, s } from '$lib/server/db';
import { coordinateInsideBounds, createGoogleCacheApi, timezoneCacheKey } from './google.shared';

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

describe(`coordinateInsideBounds`, () => {
	it(`keeps a Bali pin and drops Paradiso, Switzerland`, () => {
		const bounds = `-8.69,115.08|-8.33,115.44`;
		expect(coordinateInsideBounds({ lat: -8.51172, lng: 115.264, bounds })).toBe(true);
		expect(coordinateInsideBounds({ lat: 45.9907, lng: 8.94526, bounds })).toBe(false);
	});
});

describe(`geocodeAddressCached`, () => {
	afterEach(async () => {
		await db.delete(s.geocodeCache);
		vi.unstubAllGlobals();
	});

	it(`replaces a cached Switzerland pin for Paradiso when the bias is Ubud`, async () => {
		const cacheKey = JSON.stringify({ address: `Paradiso`, biasAddress: `Ubud, Indonesia` });
		await db.insert(s.geocodeCache).values({
			address: cacheKey,
			latitude: 45.9907,
			longitude: 8.94526,
			timezone: `Europe/Zurich`,
		});

		vi.stubGlobal(`fetch`, vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			if (url.pathname.includes(`timezone`)) {
				return { ok: true, json: async () => ({ status: `OK`, timeZoneId: `Asia/Makassar` }) };
			}
			const address = url.searchParams.get(`address`);
			const inBali = address === `Ubud, Indonesia` || address === `Paradiso, Ubud, Indonesia`;
			const location = inBali
				? { lat: address === `Ubud, Indonesia` ? -8.50685 : -8.51172, lng: address === `Ubud, Indonesia` ? 115.262 : 115.264 }
				: { lat: 45.9907, lng: 8.94526 };
			return { ok: true, json: async () => ({ status: `OK`, results: [{ geometry: { location } }] }) };
		}));

		const { geocodeAddressCached } = createGoogleCacheApi(db);
		const result = await geocodeAddressCached({
			addressLines: [`Paradiso`],
			biasAddressLines: [`Ubud`, `Indonesia`],
			apiKey: `test-key`,
		});

		expect(result).toMatchObject({ lat: -8.51172, lng: 115.264, timezone: `Asia/Makassar` });
		const cached = await db.query.geocodeCache.findFirst({
			where: eq(s.geocodeCache.address, cacheKey),
		});
		expect(cached?.latitude).toBeCloseTo(-8.51172);
		expect(cached?.longitude).toBeCloseTo(115.264);
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
