import { describe, expect, it } from 'vitest';
import {
	eventCategories,
	eventMatchesOthersCategory,
	getAssignedTagSlugs,
	getTagSlugsForCategories,
	getTagSlugsMatchingSearch,
	OTHERS_CATEGORY_SLUG,
	knownTagSlugs,
	slugsForTagInput,
} from './eventCategories';

describe(`eventCategories`, () => {

	it(`maps ecstatic dance to dance and yoga to personal growth`, () => {
		const dance = eventCategories.find((category) => category.slug === `dance`);
		const personalGrowth = eventCategories.find((category) => category.slug === `personal-growth`);
		expect(dance?.tags.map((tag) => tag.slug)).toContain(`ecstatic-dance`);
		expect(personalGrowth?.tags.map((tag) => tag.slug)).toContain(`yoga`);
	});

	it(`puts reiki in bodywork`, () => {
		const bodywork = eventCategories.find((category) => category.slug === `bodywork`);
		expect(bodywork?.tags.map((tag) => tag.slug)).toContain(`reiki`);
		expect(eventCategories.some((category) => category.slug === `healing`)).toBe(false);
	});

	it(`maps listed practices into their corresponding categories`, () => {
		const slugsByCategory = Object.fromEntries(
			eventCategories.map((category) => [category.slug, new Set(category.tags.map((tag) => tag.slug))]),
		);

		for (const slug of [`ecstatic-dance`, `free-dance`, `somatic-dance`]) {
			expect(slugsByCategory.dance.has(slug)).toBe(true);
		}
		for (const slug of [`authentic-movement`, `somatic-movement`, `qigong`, `tai-chi`, `mobility`, `pilates`, `martial-arts`, `fitness`, `flow-arts`]) {
			expect(slugsByCategory.movement.has(slug)).toBe(true);
		}
		for (const slug of [`conscious-connected-breathwork`, `pranayama`, `breath-circle`]) {
			expect(slugsByCategory.breathwork.has(slug)).toBe(true);
		}
		for (const slug of [`tre`, `myofascial-release`, `alexander-technique`]) {
			expect(slugsByCategory.bodywork.has(slug)).toBe(true);
		}
		for (const slug of [`reiki`, `pranic-healing`, `chakra-work`, `light-language`]) {
			expect(slugsByCategory[`energy-work`].has(slug)).toBe(true);
		}
		for (const slug of [`sound-healing`, `gong`, `singing-bowls`]) {
			expect(slugsByCategory[`sound-healing`].has(slug)).toBe(true);
		}
		for (const slug of [`voice-activation`, `medicine-music`, `drum-circle`]) {
			expect(slugsByCategory.music.has(slug)).toBe(true);
		}
		for (const slug of [`classical-tantra`, `neotantra`, `temple-arts`]) {
			expect(slugsByCategory.tantra.has(slug)).toBe(true);
		}
		for (const slug of [`couples-work`, `conscious-dating`, `selflove`]) {
			expect(slugsByCategory.relationship.has(slug)).toBe(true);
		}
		for (const slug of [`mindset`, `parts-work`, `family-constellations`]) {
			expect(slugsByCategory[`personal-growth`].has(slug)).toBe(true);
		}
		for (const slug of [`spiritual-awakening`, `advaita`, `enneagram`, `i-ching`, `philosophy`, `witchcraft`, `mythology`]) {
			expect(slugsByCategory.spirituality.has(slug)).toBe(true);
		}
		for (const slug of [`temazcal`, `shamanic-journey`, `ancestral-healing`, `full-moon`]) {
			expect(slugsByCategory.ceremony.has(slug)).toBe(true);
		}
	});

	it(`allows overlapping tags such as tantric dance`, () => {
		const dance = eventCategories.find((category) => category.slug === `dance`);
		const tantra = eventCategories.find((category) => category.slug === `tantra`);
		expect(dance?.tags.map((tag) => tag.slug)).toContain(`tantric-dance`);
		expect(tantra?.tags.map((tag) => tag.slug)).toContain(`tantric-dance`);
	});

	it(`treats others tags and unmapped tags as others candidates`, () => {
		const assigned = getAssignedTagSlugs();
		expect(assigned.has(`ecstatic-dance`)).toBe(true);
		expect(assigned.has(`nature`)).toBe(false);
		expect(assigned.has(`festival`)).toBe(false);
		expect(assigned.has(`creative-expression`)).toBe(false);
	});

	it(`matches catalog slugs by label and synonym for search`, () => {
		expect(getTagSlugsMatchingSearch(`yoga`)).toContain(`yoga`);
		expect(getTagSlugsMatchingSearch(`Atemarbeit`)).toContain(`breathwork`);
		expect(getTagSlugsMatchingSearch(`Contact Jam`)).toContain(`contact-improvisation`);
		expect(getTagSlugsMatchingSearch(`not-a-real-search`)).toEqual([]);
		expect(getTagSlugsMatchingSearch(` `)).toEqual([]);
	});

	it(`expands a category to matching tag slugs`, () => {
		expect(getTagSlugsForCategories([`dance`])).toEqual(expect.arrayContaining([
			`ecstatic-dance`,
			`contact-improvisation`,
		]));
		expect(getTagSlugsForCategories([`dance`])).not.toContain(`yoga`);
		expect(getTagSlugsForCategories([OTHERS_CATEGORY_SLUG])).toEqual([]);
	});

	it(`treats others as events with others or unmapped tags`, () => {
		expect(eventMatchesOthersCategory([`festival`])).toBe(true);
		expect(eventMatchesOthersCategory([`nature`])).toBe(true);
		expect(eventMatchesOthersCategory([`ecstatic-dance`, `festival`])).toBe(true);
		expect(eventMatchesOthersCategory([`ecstatic-dance`, `nature`])).toBe(true);
		expect(eventMatchesOthersCategory([`yoga`])).toBe(false);
		expect(eventMatchesOthersCategory([`ecstatic-dance`])).toBe(false);
		expect(eventMatchesOthersCategory([])).toBe(true);
		expect(eventMatchesOthersCategory(null)).toBe(true);
	});

	it(`keeps known tag slugs and drops unknown ones`, () => {
		expect(knownTagSlugs([`yoga`, `not-a-real-tag`, `meditation`, `yoga`])).toEqual([`yoga`, `meditation`]);
		expect(knownTagSlugs([])).toEqual([]);
		expect(knownTagSlugs(null)).toEqual([]);
	});

	it(`resolves synonyms and retired slugs to canonical tags`, () => {
		const breathwork = eventCategories
			.find((category) => category.slug === `breathwork`)
			?.tags.find((tag) => tag.slug === `breathwork`);
		expect(breathwork?.synonyms).toEqual(expect.arrayContaining([`Atemarbeit`, `Atemtechniken`, `Atemübungen`]));
		expect(slugsForTagInput(`Atemarbeit`)).toEqual([`breathwork`]);
		expect(slugsForTagInput(`Hexen`)).toEqual([`witchcraft`]);
		expect(slugsForTagInput(`Witchcraft`)).toEqual([`witchcraft`]);
		expect(slugsForTagInput(`Creative Expression`)).toEqual([`creative-expression`]);
		expect(slugsForTagInput(`dance-impro`)).toEqual([`dance-improvisation`]);
		expect(knownTagSlugs([`yoga`, `dance-impro`, `not-a-real-tag`])).toEqual([`yoga`, `dance-improvisation`]);
	});
});
