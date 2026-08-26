import { describe, expect, it } from 'vitest';
import { matchesBlackListWords, matchesWhiteListWords } from './whitelistWords';

describe(`matchesBlackListWords`, () => {
	it(`filters ordinary yoga class titles`, () => {
		expect(matchesBlackListWords(`Yoga am Nachmittag`)).toBe(true);
		expect(matchesBlackListWords(`Hatha Yoga im Park`)).toBe(true);
		expect(matchesBlackListWords(`Sanftes Yoga für Anfänger`)).toBe(true);
	});

	it(`does not match conscious event titles`, () => {
		expect(matchesBlackListWords(`Ecstatic Dance Berlin`)).toBe(false);
		expect(matchesBlackListWords(`Tantra Abend`)).toBe(false);
	});
});

describe(`matchesWhiteListWords`, () => {
	it(`matches known conscious-event terms`, () => {
		expect(matchesWhiteListWords(`Ecstatic Dance Berlin`)).toBe(true);
	});
});
