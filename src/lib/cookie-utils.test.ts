import { describe, expect, it } from 'vitest';
import { validateFilterData } from '$lib/cookie-utils';

describe(`cookie filter validation`, () => {
	it(`sanitizes invalid distance and keeps valid zero coordinates`, () => {
		expect(
			validateFilterData({
				plzCity: `Berlin`,
				distance: `25`,
				lat: 0,
				lng: 0
			})
		).toEqual({
			startDate: null,
			endDate: null,
			plzCity: `Berlin`,
			distance: null,
			lat: 0,
			lng: 0,
			searchTerm: null,
			sortBy: null,
			sortOrder: null,
			tagIds: null,
			attendanceMode: null
		});
	});

	it(`rejects non-numeric coordinates`, () => {
		expect(
			validateFilterData({
				plzCity: `Berlin`,
				distance: `50`,
				lat: `not-a-number`,
				lng: 13
			})
		).toBeNull();
	});
});
