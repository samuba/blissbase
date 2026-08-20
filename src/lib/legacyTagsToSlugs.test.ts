import { describe, expect, it } from 'vitest';
import { legacyTagsToSlugs, unmatchedLegacyTags } from './legacyTagsToSlugs';
import { allTags as legacyTagTranslations } from './server/tags';

describe(`legacyTagsToSlugs`, () => {
	it(`maps english, german, dutch, and already-slugified yoga tags`, () => {
		expect(legacyTagsToSlugs([`Yoga`])).toEqual([`yoga`]);
		expect(legacyTagsToSlugs([`yoga`])).toEqual([`yoga`]);
		expect(legacyTagsToSlugs([`YOGA`])).toEqual([`yoga`]);
		expect(legacyTagsToSlugs([`Meditatie`])).toEqual([`meditation`]);
		expect(legacyTagsToSlugs([`Familienaufstellung`])).toEqual([`family-constellations`]);
		expect(legacyTagsToSlugs([`ecstatic-dance`])).toEqual([`ecstatic-dance`]);
	});

	it(`uses catalog synonyms when slugify does not match the catalog slug`, () => {
		expect(legacyTagsToSlugs([`Qi Gong`])).toEqual([`qigong`]);
		expect(legacyTagsToSlugs([`qi-gong`])).toEqual([`qigong`]);
		expect(legacyTagsToSlugs([`Qigong`])).toEqual([`qigong`]);
		expect(legacyTagsToSlugs([`Relationships`])).toEqual([`relationship`]);
		expect(legacyTagsToSlugs([`Beziehungen`])).toEqual([`relationship`]);
		expect(legacyTagsToSlugs([`Tai Chi / Tai Ji`])).toEqual([`tai-chi`]);
		expect(legacyTagsToSlugs([`Tai Chi`])).toEqual([`tai-chi`]);
		expect(legacyTagsToSlugs([`Forest Bathing (Shinrin Yoku)`])).toEqual([`forest-bathing`]);
		expect(legacyTagsToSlugs([`Forest Bathing`])).toEqual([`forest-bathing`]);
		expect(legacyTagsToSlugs([`Relationship Constellations`])).toEqual([`relationship-constellation`]);
		expect(legacyTagsToSlugs([`5 Rhythmen`])).toEqual([`5rhythms`]);
		expect(legacyTagsToSlugs([`5Rhythms`])).toEqual([`5rhythms`]);
		expect(legacyTagsToSlugs([`Atemarbeit`])).toEqual([`breathwork`]);
		expect(legacyTagsToSlugs([`Bewusster Tanz`])).toEqual([`conscious-dance`]);
		expect(legacyTagsToSlugs([`Pilates`])).toEqual([`pilates`]);
		expect(legacyTagsToSlugs([`Martial Arts`])).toEqual([`martial-arts`]);
	});

	it(`expands compound legacy tags into multiple catalog slugs`, () => {
		expect(legacyTagsToSlugs([`Sound Journey / Sound Bath`])).toEqual([
			`sound-journey`,
			`sound-bath`,
		]);
		expect(legacyTagsToSlugs([`Sound Journey`])).toEqual([`sound-journey`]);
		expect(legacyTagsToSlugs([`Mantra Singing, Kirtan`])).toEqual([
			`mantra-singing`,
			`kirtan`,
		]);
	});

	it(`maps format tags, drops junk, dedupes, and keeps first-seen order`, () => {
		expect(legacyTagsToSlugs([
			`Yoga`,
			`Last Minute`,
			`Ecstatic Dance`,
			`yoga`,
			`Online`,
			`Festival`,
		])).toEqual([`yoga`, `ecstatic-dance`, `festival`]);
		expect(unmatchedLegacyTags([
			`Yoga`,
			`Last Minute`,
			`Online`,
			`Festival`,
			`3 Tage`,
		])).toEqual([`Last Minute`, `Online`, `3 Tage`]);
	});

	it(`returns an empty array for missing input`, () => {
		expect(legacyTagsToSlugs(null)).toEqual([]);
		expect(legacyTagsToSlugs([])).toEqual([]);
		expect(legacyTagsToSlugs([`  `])).toEqual([]);
	});

	it(`leaves only legacy names that have no catalog counterpart unresolved`, () => {
		const unresolved = [...new Set(legacyTagTranslations.map((tag) => tag.en))]
			.filter((name) => !legacyTagsToSlugs([name]).length)
			.sort();
		expect(unresolved).toEqual([
			`Divine Living`,
			`Double Portrait`,
			`Holiday`,
		]);
	});
});
