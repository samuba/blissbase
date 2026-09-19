import { describe, expect, it } from "vitest";
import { eventCategories, eventFormats } from "../../src/lib/eventCategories.ts";
import { CATEGORY_QUESTION_ID, FORMAT_ONLY_CATEGORY, NONE_CATEGORY, formatQuestionId } from "./constants.ts";
import { buildClassificationQuestions, buildTagQuestions, uniqueTagSlugsForCategories } from "./tagQuestions.ts";

describe(`tagQuestions`, () => {
	it(`builds one category Choice plus a Noul per format`, () => {
		const questions = buildClassificationQuestions();
		expect(questions[CATEGORY_QUESTION_ID]?.type).toBe(`choice`);
		expect(questions[CATEGORY_QUESTION_ID]?.criteria).toMatchObject({
			[FORMAT_ONLY_CATEGORY]: expect.any(String),
			[NONE_CATEGORY]: expect.any(String),
			dance: expect.any(String),
		});
		expect(Object.keys(questions[CATEGORY_QUESTION_ID].criteria).length).toBe(eventCategories.length + 2);
		for (const format of eventFormats) {
			expect(questions[formatQuestionId(format.slug)]?.type).toBe(`noul`);
		}
	});

	it(`builds tag Nouls only for the beamed categories`, () => {
		const questions = buildTagQuestions({ categorySlugs: [`dance`] });
		const danceSlugs = uniqueTagSlugsForCategories([`dance`]);
		expect(danceSlugs.length).toBeGreaterThan(0);
		expect(Object.keys(questions)).toHaveLength(danceSlugs.length);
		expect(questions[`tag:ecstatic-dance`]?.type).toBe(`noul`);
		expect(questions[`tag:breathwork`]).toBeUndefined();
	});

	it(`includes others-category tags when beamed`, () => {
		const slugs = uniqueTagSlugsForCategories([`others`]);
		expect(slugs).toContain(`nature`);
	});
});
