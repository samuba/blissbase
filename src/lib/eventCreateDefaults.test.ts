import { describe, expect, it } from 'vitest';
import { applyCreateEventLocationPrefill } from './eventCreateDefaults';

describe(`applyCreateEventLocationPrefill`, () => {
	const base = {
		address: `Berlin, Germany`,
		addressNote: `3. Stock`,
		latitude: `52.52`,
		longitude: `13.405`,
	};

	it(`keeps the pin and note when the prefill address is unchanged`, () => {
		expect(applyCreateEventLocationPrefill({
			base,
			prefillAddress: `Berlin, Germany`,
		})).toEqual(base);
	});

	it(`clears the pin and note when the prefill address changes`, () => {
		expect(applyCreateEventLocationPrefill({
			base,
			prefillAddress: `Munich, Germany`,
		})).toEqual({
			address: `Munich, Germany`,
			addressNote: ``,
			latitude: ``,
			longitude: ``,
		});
	});

	it(`keeps the current location when prefill has no address`, () => {
		expect(applyCreateEventLocationPrefill({ base })).toEqual(base);
	});
});
