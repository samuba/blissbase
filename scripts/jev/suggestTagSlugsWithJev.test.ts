import { describe, expect, it } from "vitest";
import { suggestTagSlugsWithJev } from "./suggestTagSlugsWithJev.ts";
import { CATEGORY_QUESTION_ID } from "./constants.ts";
import type { SystemOneFn } from "./jevClient.ts";

describe(`suggestTagSlugsWithJev`, () => {
	it(`takes high-noul tags from the chosen category and caps at 4`, async () => {
		const systemOne = mockSystemOne({
			category: `dance`,
			confidence: 0.92,
			tagNouls: {
				"ecstatic-dance": 0.96,
				dance: 0.88,
				"conscious-dance": 0.81,
				"5rhythms": 0.79,
				"contact-improvisation": 0.4,
			},
			formatNouls: { workshop: 0.2 },
		});

		const result = await suggestTagSlugsWithJev({
			name: `Ecstatic Dance Berlin`,
			description: `Barefoot dance`,
			systemOne,
		});

		expect(result.category).toBe(`dance`);
		expect(result.beamedCategories).toEqual([`dance`]);
		expect(result.slugs).toEqual([`ecstatic-dance`, `dance`, `conscious-dance`, `5rhythms`]);
		expect(result.slugs).toHaveLength(4);
	});

	it(`beams top categories when confidence is low`, async () => {
		const systemOne = mockSystemOne({
			category: `dance`,
			confidence: 0.2,
			probabilities: { dance: 0.34, music: 0.3, breathwork: 0.2, none: 0.16 },
			tagNouls: { "ecstatic-dance": 0.9, kirtan: 0.85, breathwork: 0.1 },
		});

		const result = await suggestTagSlugsWithJev({
			name: `Dance and song`,
			systemOne,
		});

		expect(result.beamedCategories).toEqual([`dance`, `music`, `breathwork`]);
		expect(result.slugs).toEqual([`ecstatic-dance`, `kirtan`]);
	});

	it(`skips tag questions when only a format is clear`, async () => {
		let calls = 0;
		const systemOne: SystemOneFn = async ({ questions }) => {
			calls += 1;
			return mockClassification({
				questions,
				category: `format_only`,
				confidence: 0.8,
				formatNouls: { retreat: 0.91 },
			});
		};

		const result = await suggestTagSlugsWithJev({
			name: `Weekend retreat`,
			systemOne,
		});

		expect(calls).toBe(1);
		expect(result.slugs).toEqual([`retreat`]);
		expect(result.beamedCategories).toEqual([]);
	});
});

function mockSystemOne({
	category,
	confidence,
	probabilities,
	tagNouls = {},
	formatNouls = {},
}: {
	category: string;
	confidence: number;
	probabilities?: Record<string, number>;
	tagNouls?: Record<string, number>;
	formatNouls?: Record<string, number>;
}): SystemOneFn {
	return async ({ questions }) => {
		if (CATEGORY_QUESTION_ID in questions) {
			return mockClassification({ questions, category, confidence, probabilities, formatNouls });
		}

		const answers: Record<string, { type: `noul`; noul: number }> = {};
		for (const id of Object.keys(questions)) {
			const slug = id.slice(`tag:`.length);
			answers[id] = { type: `noul`, noul: tagNouls[slug] ?? 0 };
		}
		return result(answers);
	};
}

function mockClassification({
	questions,
	category,
	confidence,
	probabilities,
	formatNouls = {},
}: {
	questions: Record<string, unknown>;
	category: string;
	confidence: number;
	probabilities?: Record<string, number>;
	formatNouls?: Record<string, number>;
}) {
	const answers: Record<string, unknown> = {
		[CATEGORY_QUESTION_ID]: {
			type: `choice`,
			choice: category,
			confidence,
			probabilities: probabilities ?? { [category]: confidence },
		},
	};
	for (const id of Object.keys(questions)) {
		if (!id.startsWith(`format:`)) continue;
		const slug = id.slice(`format:`.length);
		answers[id] = { type: `noul`, noul: formatNouls[slug] ?? 0 };
	}
	return result(answers);
}

function result(answers: Record<string, unknown>) {
	return {
		model: `jev-1.13.0`,
		answers,
		usage: { input_tokens: 12, output_tokens: 2 },
	} as never;
}
