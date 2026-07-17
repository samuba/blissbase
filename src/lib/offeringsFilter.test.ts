import { describe, expect, it } from 'vitest';
import {
	buildOfferingsFilterSearchParams,
	filterOfferingsByIncludeOnline,
	filterOfferingsBySearchTerm,
	hasOfferingsFilterParams,
	hasOfferingsFilterUrlParams,
	hasOfferingsLocationParams,
	isOfferingAvailableOnline,
	offeringsFilterFromCookie,
	parseOfferingsFilterFromUrl,
	shouldIncludeOfferingInLocationFilter,
} from '$lib/offeringsFilter';
import { getDistanceInKm, isWithinDistanceKm } from '$lib/locationFilter';

describe('parseOfferingsFilterFromUrl', () => {
	it('parses location and search params', () => {
		const filter = parseOfferingsFilterFromUrl(
			new URL(`https://blissbase.app/offerings?lat=52.5&lng=13.4&distance=50&location=Berlin&searchTerm=yoga`),
		);

		expect(filter).toEqual({
			lat: 52.5,
			lng: 13.4,
			distance: `50`,
			location: `Berlin`,
			searchTerm: `yoga`,
			includeOnline: false,
		});
	});

	it('falls back to legacy plzCity query param', () => {
		const filter = parseOfferingsFilterFromUrl(
			new URL(`https://blissbase.app/offerings?plzCity=Berlin&distance=50`),
		);

		expect(filter.location).toBe(`Berlin`);
		expect(filter.distance).toBe(`50`);
	});

	it('parses includeOnline param', () => {
		expect(parseOfferingsFilterFromUrl(new URL(`https://blissbase.app/offerings?includeOnline=1`)).includeOnline).toBe(true);
		expect(parseOfferingsFilterFromUrl(new URL(`https://blissbase.app/offerings?includeOnline=true`)).includeOnline).toBe(true);
		expect(parseOfferingsFilterFromUrl(new URL(`https://blissbase.app/offerings?onlineOnly=1`)).includeOnline).toBe(true);
	});

	it('returns nulls for missing params', () => {
		const filter = parseOfferingsFilterFromUrl(new URL(`https://blissbase.app/offerings`));

		expect(filter).toEqual({
			lat: null,
			lng: null,
			distance: null,
			location: null,
			searchTerm: null,
			includeOnline: false,
		});
	});
});

describe('hasOfferingsLocationParams', () => {
	it('detects any location param', () => {
		expect(hasOfferingsLocationParams({ location: null, distance: null, lat: null, lng: null, searchTerm: null, includeOnline: false })).toBe(false);
		expect(hasOfferingsLocationParams({ location: `Berlin`, distance: null, lat: null, lng: null, searchTerm: null, includeOnline: false })).toBe(true);
		expect(hasOfferingsLocationParams({ location: null, distance: `50`, lat: null, lng: null, searchTerm: null, includeOnline: false })).toBe(true);
		expect(hasOfferingsLocationParams({ location: null, distance: null, lat: 1, lng: 2, searchTerm: null, includeOnline: false })).toBe(true);
	});
});

describe('hasOfferingsFilterParams', () => {
	it('detects search and includeOnline without location', () => {
		expect(hasOfferingsFilterParams({ location: null, distance: null, lat: null, lng: null, searchTerm: `yoga`, includeOnline: false })).toBe(true);
		expect(hasOfferingsFilterParams({ location: null, distance: null, lat: null, lng: null, searchTerm: null, includeOnline: true })).toBe(true);
		expect(hasOfferingsFilterParams({ location: null, distance: null, lat: null, lng: null, searchTerm: null, includeOnline: false })).toBe(false);
	});
});

describe('hasOfferingsFilterUrlParams', () => {
	it('detects explicit filter query keys', () => {
		expect(hasOfferingsFilterUrlParams(new URL(`https://blissbase.app/offerings`))).toBe(false);
		expect(hasOfferingsFilterUrlParams(new URL(`https://blissbase.app/offerings?searchTerm=yoga`))).toBe(true);
		expect(hasOfferingsFilterUrlParams(new URL(`https://blissbase.app/offerings?includeOnline=1`))).toBe(true);
		expect(hasOfferingsFilterUrlParams(new URL(`https://blissbase.app/offerings?location=Berlin`))).toBe(true);
	});
});

describe('offeringsFilterFromCookie', () => {
	it('maps offerings-specific cookie fields', () => {
		expect(
			offeringsFilterFromCookie({
				plzCity: `Berlin`,
				distance: `50`,
				lat: 52.5,
				lng: 13.4,
				searchTerm: `events-search`,
				offeringsSearchTerm: `yoga`,
				includeOnline: true,
			}),
		).toEqual({
			location: `Berlin`,
			distance: `50`,
			lat: 52.5,
			lng: 13.4,
			searchTerm: `yoga`,
			includeOnline: true,
		});
	});

	it('defaults when cookie is missing', () => {
		expect(offeringsFilterFromCookie(null)).toEqual({
			location: null,
			distance: null,
			lat: null,
			lng: null,
			searchTerm: null,
			includeOnline: false,
		});
	});
});

describe('buildOfferingsFilterSearchParams', () => {
	it('omits empty values', () => {
		const params = buildOfferingsFilterSearchParams({
			location: `Berlin`,
			distance: `50`,
			lat: 52.5,
			lng: 13.4,
			searchTerm: null,
			includeOnline: false,
		});

		expect(params.toString()).toBe(`location=Berlin&distance=50&lat=52.5&lng=13.4`);
	});

	it('includes includeOnline when enabled', () => {
		const params = buildOfferingsFilterSearchParams({
			location: null,
			distance: null,
			lat: null,
			lng: null,
			searchTerm: null,
			includeOnline: true,
		});

		expect(params.toString()).toBe(`includeOnline=1`);
	});
});

describe('filterOfferingsBySearchTerm', () => {
	const offerings = [
		{
			title: `Yoga Session`,
			descriptionHtml: `<p>Relaxing flow</p>`,
			profile: { displayName: `Anna` },
		},
		{
			title: `Massage`,
			descriptionHtml: `<p>Deep tissue</p>`,
			profile: { displayName: `Ben` },
		},
	];

	it('filters by title, description, and host', () => {
		expect(filterOfferingsBySearchTerm({ offerings, searchTerm: `yoga` })).toHaveLength(1);
		expect(filterOfferingsBySearchTerm({ offerings, searchTerm: `tissue` })).toHaveLength(1);
		expect(filterOfferingsBySearchTerm({ offerings, searchTerm: `anna` })).toHaveLength(1);
		expect(filterOfferingsBySearchTerm({ offerings, searchTerm: null })).toHaveLength(2);
	});
});

describe('filterOfferingsByIncludeOnline', () => {
	const offerings = [
		{ id: 1, format: `online` as const },
		{ id: 2, format: `offline` as const },
		{ id: 3, format: `offline+online` as const },
	];

	it('returns all offerings when includeOnline is true', () => {
		expect(filterOfferingsByIncludeOnline({ offerings, includeOnline: true })).toHaveLength(3);
	});

	it('excludes only pure online offerings when includeOnline is false', () => {
		const filtered = filterOfferingsByIncludeOnline({ offerings, includeOnline: false });
		expect(filtered).toHaveLength(2);
		expect(filtered.map((offering) => offering.id)).toEqual([2, 3]);
	});
});

describe('isOfferingAvailableOnline', () => {
	it('detects online-capable formats', () => {
		expect(isOfferingAvailableOnline(`online`)).toBe(true);
		expect(isOfferingAvailableOnline(`offline+online`)).toBe(true);
		expect(isOfferingAvailableOnline(`offline`)).toBe(false);
	});
});

describe('isWithinDistanceKm', () => {
	it('returns true for nearby coordinates', () => {
		const berlinLat = 52.52;
		const berlinLng = 13.405;
		const nearbyLat = 52.53;
		const nearbyLng = 13.41;

		expect(
			isWithinDistanceKm({
				fromLat: berlinLat,
				fromLng: berlinLng,
				toLat: nearbyLat,
				toLng: nearbyLng,
				distanceKm: 50,
			}),
		).toBe(true);
	});

	it('returns false for far coordinates', () => {
		expect(
			isWithinDistanceKm({
				fromLat: 52.52,
				fromLng: 13.405,
				toLat: 48.137,
				toLng: 11.575,
				distanceKm: 50,
			}),
		).toBe(false);
	});

	it('distance helper is symmetric', () => {
		const distance = getDistanceInKm({
			fromLat: 16.0544,
			fromLng: 108.2022,
			toLat: 15.8801,
			toLng: 108.338,
		});

		expect(distance).toBeGreaterThan(15);
		expect(distance).toBeLessThan(35);
	});
});

describe('shouldIncludeOfferingInLocationFilter', () => {
	const filterCoords = { lat: 16.0544, lng: 108.2022 };

	it('includes online offerings only when includeOnline is true', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `online`,
				includeOnline: true,
				profileLatitude: null,
				profileLongitude: null,
				filterCoords,
				distanceKm: 10,
			}),
		).toBe(true);
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `online`,
				includeOnline: false,
				profileLatitude: null,
				profileLongitude: null,
				filterCoords,
				distanceKm: 10,
			}),
		).toBe(false);
	});

	it('includes hybrid offerings when includeOnline is true', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `offline+online`,
				includeOnline: true,
				profileLatitude: null,
				profileLongitude: null,
				filterCoords,
				distanceKm: 10,
			}),
		).toBe(true);
	});

	it('includes nearby hybrid offerings when includeOnline is false', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `offline+online`,
				includeOnline: false,
				profileLatitude: 16.06,
				profileLongitude: 108.21,
				filterCoords,
				distanceKm: 10,
			}),
		).toBe(true);
	});

	it('includes offline offerings within radius', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `offline`,
				includeOnline: false,
				profileLatitude: 16.06,
				profileLongitude: 108.21,
				filterCoords,
				distanceKm: 50,
			}),
		).toBe(true);
	});

	it('excludes offline offerings outside radius', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `offline`,
				includeOnline: false,
				profileLatitude: 52.52,
				profileLongitude: 13.405,
				filterCoords,
				distanceKm: 50,
			}),
		).toBe(false);
	});

	it('excludes offline offerings without profile coordinates', () => {
		expect(
			shouldIncludeOfferingInLocationFilter({
				format: `offline`,
				includeOnline: false,
				profileLatitude: null,
				profileLongitude: null,
				filterCoords,
				distanceKm: 50,
			}),
		).toBe(false);
	});
});
