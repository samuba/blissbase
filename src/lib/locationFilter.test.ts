import { describe, expect, it } from 'vitest';
import {
	ALLOWED_DISTANCE_VALUES,
	coarseLatLngForAnalytics,
	hasValidCoordinates,
	isValidDistance,
	isValidLatitude,
	isValidLongitude,
	sanitizeLocationParams
} from '$lib/locationFilter';

describe(`isValidLatitude`, () => {
	it(`accepts valid latitudes including 0`, () => {
		expect(isValidLatitude(0)).toBe(true);
		expect(isValidLatitude(52.5)).toBe(true);
		expect(isValidLatitude(-90)).toBe(true);
		expect(isValidLatitude(90)).toBe(true);
	});

	it(`rejects out-of-range and invalid values`, () => {
		expect(isValidLatitude(91)).toBe(false);
		expect(isValidLatitude(-91)).toBe(false);
		expect(isValidLatitude(NaN)).toBe(false);
		expect(isValidLatitude(null)).toBe(false);
	});
});

describe(`isValidLongitude`, () => {
	it(`accepts valid longitudes including 0`, () => {
		expect(isValidLongitude(0)).toBe(true);
		expect(isValidLongitude(13.4)).toBe(true);
		expect(isValidLongitude(-180)).toBe(true);
		expect(isValidLongitude(180)).toBe(true);
	});

	it(`rejects out-of-range and invalid values`, () => {
		expect(isValidLongitude(181)).toBe(false);
		expect(isValidLongitude(-181)).toBe(false);
		expect(isValidLongitude(NaN)).toBe(false);
	});
});

describe(`isValidDistance`, () => {
	it(`accepts allowed distance values and empty`, () => {
		for (const distance of ALLOWED_DISTANCE_VALUES) {
			expect(isValidDistance(distance)).toBe(true);
		}
		expect(isValidDistance(``)).toBe(true);
		expect(isValidDistance(null)).toBe(true);
	});

	it(`rejects unknown distances`, () => {
		expect(isValidDistance(`25`)).toBe(false);
		expect(isValidDistance(`abc`)).toBe(false);
	});
});

describe(`hasValidCoordinates`, () => {
	it(`treats 0,0 as valid`, () => {
		expect(hasValidCoordinates({ lat: 0, lng: 0 })).toBe(true);
	});

	it(`rejects partial or invalid coordinates`, () => {
		expect(hasValidCoordinates({ lat: 0, lng: null })).toBe(false);
		expect(hasValidCoordinates({ lat: 200, lng: 0 })).toBe(false);
	});
});

describe(`sanitizeLocationParams`, () => {
	it(`keeps valid location params`, () => {
		expect(
			sanitizeLocationParams({
				plzCity: `Berlin`,
				distance: `50`,
				lat: 52.5,
				lng: 13.4
			})
		).toEqual({
			plzCity: `Berlin`,
			distance: `50`,
			lat: 52.5,
			lng: 13.4
		});
	});

	it(`clears invalid distance and coordinates`, () => {
		expect(
			sanitizeLocationParams({
				plzCity: `Berlin`,
				distance: `25`,
				lat: 0,
				lng: 200
			})
		).toEqual({
			plzCity: `Berlin`,
			distance: null,
			lat: null,
			lng: null
		});
	});
});

describe(`coarseLatLngForAnalytics`, () => {
	it(`rounds coordinates to one decimal place`, () => {
		expect(coarseLatLngForAnalytics({ lat: 52.56789, lng: 13.41234 })).toEqual({
			lat: 52.6,
			lng: 13.4
		});
	});

	it(`omits invalid coordinates`, () => {
		expect(coarseLatLngForAnalytics({ lat: null, lng: 13 })).toEqual({
			lat: undefined,
			lng: undefined
		});
	});
});
