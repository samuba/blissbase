import { describe, expect, it } from 'vitest';
import { matchesBlackListWords, matchesWhiteListWords } from './whitelistWords';

describe(`matchesBlackListWords`, () => {
	it(`filters ordinary yoga class titles`, () => {
		expect(matchesBlackListWords(`Yoga am Nachmittag`)).toBe(true);
		expect(matchesBlackListWords(`Hatha Yoga im Park`)).toBe(true);
		expect(matchesBlackListWords(`Sanftes Yoga für Anfänger`)).toBe(true);
	});

	it(`filters teen, child and kinder yoga titles`, () => {
		expect(matchesBlackListWords(`Teen Yoga Workshop`)).toBe(true);
		expect(matchesBlackListWords(`Teen-Yoga für Jugendliche`)).toBe(true);
		expect(matchesBlackListWords(`Child Yoga Klasse`)).toBe(true);
		expect(matchesBlackListWords(`Child-Yoga am Samstag`)).toBe(true);
		expect(matchesBlackListWords(`Children's Yoga for Kids`)).toBe(true);
		expect(matchesBlackListWords(`Kinder Yoga Gruppe`)).toBe(true);
		expect(matchesBlackListWords(`Kinder-Yoga im Park`)).toBe(true);
		expect(matchesBlackListWords(`Kinderyoga Berlin`)).toBe(true);
		expect(matchesBlackListWords(`Kids Yoga`)).toBe(true);
		expect(matchesBlackListWords(`Kids-Yoga`)).toBe(true);
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

	it(`matches event category labels and synonyms`, () => {
		expect(matchesWhiteListWords(`5Rhythms Workshop`)).toBe(true);
		expect(matchesWhiteListWords(`Kuschelparty Hamburg`)).toBe(true);
		expect(matchesWhiteListWords(`Gewaltfreie Kommunikation Abend`)).toBe(true);
	});
});
