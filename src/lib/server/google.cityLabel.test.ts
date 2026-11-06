import { describe, expect, it } from 'vitest';
import { cityLabelFromAddressComponents, type GeocodeAddressComponent } from '$lib/server/google.shared';

describe(`cityLabelFromAddressComponents`, () => {
	it(`uses the province when the top region is only the country`, () => {
		expect(
			cityLabelFromAddressComponents([
				component(`Hoi An`, `Hoi An`, [`locality`, `political`]),
				component(`An Giang`, `An Giang`, [`administrative_area_level_2`, `political`]),
				component(`Vietnam`, `VN`, [`administrative_area_level_1`, `political`]),
				component(`Vietnam`, `VN`, [`country`, `political`]),
			]),
		).toBe(`Hoi An, An Giang`);
	});

	it(`does not append a country code when no province is present`, () => {
		expect(
			cityLabelFromAddressComponents([
				component(`Hoi An`, `Hoi An`, [`locality`, `political`]),
				component(`Vietnam`, `VN`, [`administrative_area_level_1`, `political`]),
				component(`Vietnam`, `VN`, [`country`, `political`]),
			]),
		).toBe(`Hoi An`);
	});

	it(`keeps a real region short code`, () => {
		expect(
			cityLabelFromAddressComponents([
				component(`München`, `München`, [`locality`, `political`]),
				component(`Bayern`, `BY`, [`administrative_area_level_1`, `political`]),
				component(`Deutschland`, `DE`, [`country`, `political`]),
			]),
		).toBe(`München, BY`);
	});

	it(`omits the region when it repeats the city`, () => {
		expect(
			cityLabelFromAddressComponents([
				component(`Berlin`, `Berlin`, [`locality`, `political`]),
				component(`Berlin`, `BE`, [`administrative_area_level_1`, `political`]),
				component(`Deutschland`, `DE`, [`country`, `political`]),
			]),
		).toBe(`Berlin`);
	});
});

function component(longName: string, shortName: string, types: string[]): GeocodeAddressComponent {
	return { long_name: longName, short_name: shortName, types };
}
