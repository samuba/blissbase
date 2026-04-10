import { describe, expect, it } from 'vitest';
import { extractLatLngBounds, mergeLatLngBounds } from './faqEventRegions';

describe(`faqEventRegions`, () => {
	it(`prefers explicit geometry bounds`, () => {
		const bounds = extractLatLngBounds({
			bounds: {
				southwest: { lat: 47.2, lng: 8.1 },
				northeast: { lat: 47.9, lng: 8.8 }
			},
			viewport: {
				southwest: { lat: 1, lng: 1 },
				northeast: { lat: 2, lng: 2 }
			}
		});

		expect(bounds).toEqual({
			southWestLat: 47.2,
			southWestLng: 8.1,
			northEastLat: 47.9,
			northEastLng: 8.8
		});
	});

	it(`falls back to viewport bounds`, () => {
		const bounds = extractLatLngBounds({
			viewport: {
				southwest: { lat: 15.8, lng: 108.1 },
				northeast: { lat: 16.7, lng: 108.6 }
			}
		});

		expect(bounds).toEqual({
			southWestLat: 15.8,
			southWestLng: 108.1,
			northEastLat: 16.7,
			northEastLng: 108.6
		});
	});

	it(`merges multiple bounds into one region`, () => {
		const bounds = mergeLatLngBounds([
			{
				southWestLat: 15.8,
				southWestLng: 108.1,
				northEastLat: 16.2,
				northEastLng: 108.4
			},
			{
				southWestLat: 15.7,
				southWestLng: 108.2,
				northEastLat: 16.5,
				northEastLng: 108.6
			}
		]);

		expect(bounds).toEqual({
			southWestLat: 15.7,
			southWestLng: 108.1,
			northEastLat: 16.5,
			northEastLng: 108.6
		});
	});
});
