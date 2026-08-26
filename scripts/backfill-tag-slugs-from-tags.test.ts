import { describe, expect, it } from "vitest";
import { normalizeEventTagSlugs, resolveCatalogSlugs } from "./backfill-tag-slugs-from-tags";

describe(`normalizeEventTagSlugs`, () => {
	it(`keeps canonical slugs and removes duplicates`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`yoga`, `meditation`, `yoga`],
			}),
		).toEqual([`yoga`, `meditation`]);
	});

	it(`normalizes stale stored aliases through the current catalog`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`relationships`, `gatherings`, `womens-workshops`, `music-evening`],
			}),
		).toEqual([`relationship`, `gathering`, `womens-workshop`, `live-music`]);
	});

	it(`splits the obsolete combined sound slug`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`sound-journey-sound-bath`],
			}),
		).toEqual([`sound-journey`, `sound-bath`]);
	});

	it(`preserves concepts from removed catalog slugs`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`childrens-yoga`, `menopause-transition`, `hands-on-energy-healing`],
			}),
		).toEqual([`yoga`, `childrens-workshop`, `menopause`, `hands-on-healing`]);
	});

	it(`merges missing catalog concepts from legacy tags`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`family`, `nature`],
				legacyTags: [`Children's Workshop`, `Sound Journey / Sound Bath`],
			}),
		).toEqual([`family`, `nature`, `childrens-workshop`, `sound-journey`, `sound-bath`]);
	});

	it(`recovers removed concepts from legacy labels`, () => {
		expect(
			normalizeEventTagSlugs({
				legacyTags: [`Children's Yoga`],
			}),
		).toEqual([`yoga`, `childrens-workshop`]);
	});

	it(`drops unknown stored and legacy values`, () => {
		expect(
			normalizeEventTagSlugs({
				tagSlugs: [`holiday`, `yoga`],
				legacyTags: [`4 Tage`, `Other`],
			}),
		).toEqual([`yoga`]);
	});
});

describe(`resolveCatalogSlugs`, () => {
	it(`resolves translated labels and compound values`, () => {
		expect(resolveCatalogSlugs(`Atemarbeit`)).toEqual([`breathwork`]);
		expect(resolveCatalogSlugs(`Mantra Singing, Kirtan`)).toEqual([`mantra-singing`, `kirtan`]);
	});
});
