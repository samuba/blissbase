import { describe, expect, it } from 'vitest';
import {
	COASTAL_HOI_AN,
	disambiguatedPlaceLabel,
	mentionsHoiAn,
	omitOtherHoiAnSuggestions,
	preferCoastalHoiAnCoordinates,
	preferCoastalHoiAnPlace,
	sameDeclaredPlace,
	wantsCoastalHoiAn,
} from '$lib/placeLabel';

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

describe(`coastal Hoi An selection`, () => {
	it(`treats Hoyan and Hoi An as the coastal city`, () => {
		expect(wantsCoastalHoiAn(`Hoyan`)).toBe(true);
		expect(wantsCoastalHoiAn(`Hội An`)).toBe(true);
		expect(wantsCoastalHoiAn(`Hoi An, VN`)).toBe(true);
		expect(wantsCoastalHoiAn(`Hội An, An Giang`)).toBe(false);
	});

	it(`hides the An Giang commune and keeps the coastal city and other An Giang places`, () => {
		expect(mentionsHoiAn(`Hội An, An Giang`)).toBe(true);
		expect(omitOtherHoiAnSuggestions([
			{ text: `Hội An, An Giang, Vietnam` },
			{ text: `Hội An, Chợ Mới, An Giang, Vietnam` },
			{ text: `Hội An, Đà Nẵng, Vietnam` },
			{ text: `Long Xuyên, An Giang, Vietnam` },
			{ text: `The Nam Hai, Hội An` },
		]).map((suggestion) => suggestion.text)).toEqual([
			`Hội An, Đà Nẵng, Vietnam`,
			`Long Xuyên, An Giang, Vietnam`,
			`The Nam Hai, Hội An`,
		]);
	});

	it(`rewrites an unlabeled An Giang pin to coastal Hội An`, () => {
		expect(preferCoastalHoiAnPlace({
			query: `Hoyan`,
			suggestionText: `Hoi An, Vietnam`,
			displayName: `Hoi An, VN`,
			formattedAddress: `Hoi An, VN`,
			latitude: 10.3838,
			longitude: 105.489,
		})).toMatchObject({
			displayName: COASTAL_HOI_AN.label,
			latitude: COASTAL_HOI_AN.lat,
			longitude: COASTAL_HOI_AN.lng,
		});
	});

	it(`rewrites a selected An Giang Hội An pin and keeps a coastal venue`, () => {
		const anGiang = preferCoastalHoiAnPlace({
			query: `Hoi An`,
			suggestionText: `Hội An, An Giang, Vietnam`,
			displayName: `Hội An`,
			formattedAddress: `Hội An, An Giang, Vietnam`,
			latitude: 10.3838,
			longitude: 105.489,
		});
		expect(anGiang.latitude).toBe(COASTAL_HOI_AN.lat);
		expect(anGiang.longitude).toBe(COASTAL_HOI_AN.lng);

		const namHai = preferCoastalHoiAnPlace({
			query: `Hoi An`,
			suggestionText: `The Nam Hai, Hội An`,
			displayName: `The Nam Hai`,
			formattedAddress: `Hội An, Đà Nẵng, Vietnam`,
			latitude: 15.97,
			longitude: 108.3,
		});
		expect(namHai.latitude).toBe(15.97);

		const longXuyen = preferCoastalHoiAnPlace({
			query: `Hoi An`,
			suggestionText: `Long Xuyên, An Giang, Vietnam`,
			displayName: `Long Xuyên`,
			formattedAddress: `Long Xuyên, An Giang, Vietnam`,
			latitude: 10.386,
			longitude: 105.435,
		});
		expect(longXuyen.latitude).toBe(10.386);
	});

	it(`geocodes a bare Hoi An query to the coast when Google returns An Giang`, () => {
		expect(preferCoastalHoiAnCoordinates({ query: `Hoi An`, lat: 10.3838, lng: 105.489 })).toEqual({
			lat: COASTAL_HOI_AN.lat,
			lng: COASTAL_HOI_AN.lng,
		});
		expect(preferCoastalHoiAnCoordinates({ query: `Hội An, An Giang`, lat: 10.3838, lng: 105.489 })).toEqual({
			lat: 10.3838,
			lng: 105.489,
		});
		expect(preferCoastalHoiAnCoordinates({ query: `Hoi An`, lat: 15.8796, lng: 108.3319 })).toEqual({
			lat: 15.8796,
			lng: 108.3319,
		});
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
