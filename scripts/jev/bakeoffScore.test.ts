import { describe, expect, it } from "vitest";
import { scorePrediction, summarizeScores } from "./bakeoffScore.ts";
import { sampleGoldSet } from "./goldSet.ts";
import { guessLanguage } from "./languageGuess.ts";

describe(`scorePrediction`, () => {
	it(`scores precision and recall of the top slugs against gold`, () => {
		const score = scorePrediction({
			gold: [`ecstatic-dance`, `dance`],
			predicted: [`ecstatic-dance`, `workshop`],
		});
		expect(score.hits).toBe(1);
		expect(score.precision).toBe(0.5);
		expect(score.recall).toBe(0.5);
		expect(score.invented).toEqual([]);
		expect(score.overlapAccept).toBe(true);
	});

	it(`flags invented slugs that are not in the catalog`, () => {
		const score = scorePrediction({
			gold: [`yoga`],
			predicted: [`made-up-slug`],
		});
		expect(score.invented).toEqual([`made-up-slug`]);
		expect(score.overlapAccept).toBe(false);
	});
});

describe(`summarizeScores`, () => {
	it(`averages metrics and splits by language`, () => {
		const summary = summarizeScores([
			{ ...scorePrediction({ gold: [`dance`], predicted: [`dance`] }), language: `de` },
			{ ...scorePrediction({ gold: [`yoga`], predicted: [`meditation`] }), language: `en` },
		]);
		expect(summary.count).toBe(2);
		expect(summary.byLanguage.de.count).toBe(1);
		expect(summary.byLanguage.de.f1).toBe(1);
		expect(summary.inventedCount).toBe(0);
	});
});

describe(`sampleGoldSet`, () => {
	it(`biases toward German rows`, () => {
		const events = [...Array.from({ length: 5 }, (_, i) => gold(i, `de`)), gold(10, `en`), gold(11, `id`)];
		const sampled = sampleGoldSet({ events, limit: 4 });
		expect(sampled.filter((event) => event.language === `de`).length).toBeGreaterThanOrEqual(2);
		expect(sampled.some((event) => event.language === `en`)).toBe(true);
	});
});

describe(`guessLanguage`, () => {
	it(`detects German from umlauts and DE sources`, () => {
		expect(guessLanguage({ name: `Ekstatischer Tanz`, description: `Für den Körper`, source: `heilnetz` })).toBe(`de`);
		expect(guessLanguage({ name: `Kirtan night`, description: `Mantra singing`, source: `yogabarn` })).toBe(`en`);
		expect(guessLanguage({ name: `Workshop`, description: `Acara tantra di Bali`, source: `megatix_indonesia` })).toBe(`id`);
	});
});

function gold(id: number, language: `de` | `en` | `id`) {
	return {
		id,
		name: `${language} event ${id}`,
		description: language === `de` ? `Tanz und Atem` : `event`,
		tagSlugs: [`dance`],
		source: language === `id` ? `megatix_indonesia` : `heilnetz`,
		language,
	};
}
