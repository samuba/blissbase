import { describe, expect, it } from 'vitest';
import { disambiguatedPlaceLabel, sameDeclaredPlace } from '$lib/placeLabel';

describe(`sameDeclaredPlace`, () => {
	it(`matches a short Hoi An label to the coastal search name`, () => {
		expect(sameDeclaredPlace({ label: `Hoi An, VN`, search: `Hội An` })).toBe(true);
		expect(sameDeclaredPlace({ label: `Hoi An, VN`, search: `Hoi An` })).toBe(true);
		expect(sameDeclaredPlace({ label: `Thành phố Hội An`, search: `Hoi An` })).toBe(true);
	});

	it(`does not match a different region or a different city`, () => {
		expect(sameDeclaredPlace({ label: `Hội An, An Giang`, search: `Hoi An` })).toBe(false);
		expect(sameDeclaredPlace({ label: `Hoi An`, search: `Hội An, An Giang` })).toBe(false);
		expect(sameDeclaredPlace({ label: `Hoi An, VN`, search: `Da Nang` })).toBe(false);
		expect(sameDeclaredPlace({ label: `Niebüll`, search: `Hoi An` })).toBe(false);
		expect(sameDeclaredPlace({ label: `Berlin, OH`, search: `Berlin` })).toBe(false);
	});

	it(`ignores a country suffix`, () => {
		expect(sameDeclaredPlace({ label: `Berlin, Germany`, search: `Berlin` })).toBe(true);
		expect(sameDeclaredPlace({ label: null, search: `Hoi An` })).toBe(false);
		expect(sameDeclaredPlace({ label: `Hoi An`, search: null })).toBe(false);
	});
});

describe(`disambiguatedPlaceLabel`, () => {
	it(`keeps the province when diacritics differ`, () => {
		expect(
			disambiguatedPlaceLabel({
				displayName: `Hoi An`,
				formattedAddress: `Hội An, An Giang, Vietnam`,
			}),
		).toBe(`Hội An, An Giang, Vietnam`);
	});

	it(`prefixes a venue that the address does not already name`, () => {
		expect(
			disambiguatedPlaceLabel({
				displayName: `The Nam Hai`,
				formattedAddress: `Hội An, Quảng Nam, Vietnam`,
			}),
		).toBe(`The Nam Hai, Hội An, Quảng Nam, Vietnam`);
	});
});
