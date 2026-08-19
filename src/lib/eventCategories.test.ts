import { describe, expect, it } from 'vitest';
import {
	eventCategories,
	eventHasNoMappedCategoryTags,
	getAssignedTagSlugs,
	OTHERS_CATEGORY_SLUG,
	resolveTagIdsForCategories,
} from './eventCategories';

describe(`eventCategories`, () => {
	it(`lists the compressed filter categories in the expected order`, () => {
		expect(eventCategories.map((category) => category.slug)).toEqual([
			`dance`,
			`meditation`,
			`tantra`,
			`breathwork`,
			`movement`,
			`energy-work`,
			`sound-healing`,
			`bodywork`,
			`music`,
			`relationship`,
			`personal-growth`,
			`spirituality`,
			`ceremony`,
			`others`,
		]);
	});

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
		for (const slug of [`authentic-movement`, `somatic-movement`, `qigong`, `tai-chi`, `mobility-functional-movement`, `acro-partner-movement`]) {
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
		for (const slug of [`sound-healing`, `gong`, `crystal-bowls`]) {
			expect(slugsByCategory[`sound-healing`].has(slug)).toBe(true);
		}
		for (const slug of [`voice-activation`, `medicine-music`, `drum-circles`]) {
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
		for (const slug of [`spiritual-awakening`, `advaita`, `enneagram`, `i-ching`]) {
			expect(slugsByCategory.spirituality.has(slug)).toBe(true);
		}
		for (const slug of [`temazcal`, `shamanic-journey`, `ancestral-healing`, `full-moon-ceremony`]) {
			expect(slugsByCategory.ceremony.has(slug)).toBe(true);
		}
	});

	it(`allows overlapping tags such as tantric dance`, () => {
		const dance = eventCategories.find((category) => category.slug === `dance`);
		const tantra = eventCategories.find((category) => category.slug === `tantra`);
		expect(dance?.tags.map((tag) => tag.slug)).toContain(`tantric-dance`);
		expect(tantra?.tags.map((tag) => tag.slug)).toContain(`tantric-dance`);
	});

	it(`treats unmapped tags as others candidates`, () => {
		const assigned = getAssignedTagSlugs();
		expect(assigned.has(`ecstatic-dance`)).toBe(true);
		expect(assigned.has(`festival`)).toBe(false);
	});

	it(`expands a category to matching tag IDs`, () => {
		const ids = resolveTagIdsForCategories({
			categorySlugs: [`dance`],
			tags: [
				{ id: 1, slug: `ecstatic-dance` },
				{ id: 2, slug: `yoga` },
				{ id: 3, slug: `contact-improvisation` },
			],
		});
		expect(ids).toEqual([1, 3]);
	});

	it(`unions tag IDs across selected categories`, () => {
		const ids = resolveTagIdsForCategories({
			categorySlugs: [`dance`, `meditation`],
			tags: [
				{ id: 1, slug: `ecstatic-dance` },
				{ id: 2, slug: `yoga` },
				{ id: 3, slug: `meditation` },
			],
		});
		expect(ids).toEqual([1, 3]);
	});

	it(`does not resolve others as tag IDs`, () => {
		const ids = resolveTagIdsForCategories({
			categorySlugs: [OTHERS_CATEGORY_SLUG],
			tags: [
				{ id: 1, slug: `ecstatic-dance` },
				{ id: 2, slug: `festival` },
				{ id: 3, slug: `lecture` },
			],
		});
		expect(ids).toEqual([]);
	});

	it(`ignores others when expanding mapped category tag IDs`, () => {
		const ids = resolveTagIdsForCategories({
			categorySlugs: [`dance`, OTHERS_CATEGORY_SLUG],
			tags: [
				{ id: 1, slug: `ecstatic-dance` },
				{ id: 2, slug: `festival` },
				{ id: 3, slug: `yoga` },
			],
		});
		expect(ids).toEqual([1]);
	});

	it(`treats others as events with no mapped category tags`, () => {
		expect(eventHasNoMappedCategoryTags([`festival`, `lecture`])).toBe(true);
		expect(eventHasNoMappedCategoryTags([`ecstatic-dance`, `festival`])).toBe(false);
		expect(eventHasNoMappedCategoryTags([`yoga`])).toBe(false);
		expect(eventHasNoMappedCategoryTags([])).toBe(true);
		expect(eventHasNoMappedCategoryTags(null)).toBe(true);
	});
});
