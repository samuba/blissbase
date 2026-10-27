import { describe, expect, it } from 'vitest';
import { matchesBlackListWords, matchesWhiteListWords, shouldListScrapedEvent } from './whitelistWords';

describe(`matchesBlackListWords`, () => {
	it(`filters ordinary yoga class titles`, () => {
		expect(matchesBlackListWords(`Yoga am Nachmittag`)).toBe(true);
		expect(matchesBlackListWords(`Hatha Yoga im Park`)).toBe(true);
		expect(matchesBlackListWords(`Sanftes Yoga für Anfänger`)).toBe(true);
	});

	it(`matches capitalized blacklist keywords case-insensitively`, () => {
		expect(matchesBlackListWords(`fortlaufender Engpassdehnungskurs nach Liebscher & Bracht`)).toBe(true);
		expect(matchesBlackListWords(`Bewegungs-Kurs nach Liebscher & Bracht/ fayo®-Faszienyoga`)).toBe(true);
		expect(matchesBlackListWords(`Abend mit Faszien-Yoga`)).toBe(true);
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

	it(`lists a conscious description when the title has no whitelist word`, () => {
		expect(shouldListScrapedEvent({
			name: `DISSOLVE :: PLAY`,
			description: `<p>inspired by contact improvisation and authentic relating</p>`,
			source: `megatix_indonesia`,
		})).toBe(true);
		expect(shouldListScrapedEvent({
			name: `DISSOLVE :: PLAY`,
			description: `doors open at 11`,
			source: `megatix_indonesia`,
		})).toBe(false);
	});

	it(`matches event category labels and synonyms`, () => {
		expect(matchesWhiteListWords(`5Rhythms Workshop`)).toBe(true);
		expect(matchesWhiteListWords(`Kuschelparty Hamburg`)).toBe(true);
		expect(matchesWhiteListWords(`Gewaltfreie Kommunikation Abend`)).toBe(true);
	});
});
