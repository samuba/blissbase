import { describe, expect, it } from "vitest";
import { choice, noul, score } from "@typesafe-ai/sdk";
import { fromEvaluateAnswers, toEvaluateQuestions } from "./jevClient.ts";

describe(`Gateway ↔ TypeSafe question mapping`, () => {
	it(`maps noul questions to evaluate booleans and back`, () => {
		const questions = {
			fit: noul(`Is this a dance event?`, { true: `dance`, false: `not dance` }),
			category: choice(`Which category?`, { dance: `Tanz`, none: `None` }),
			clarity: score(`How clearly is the topic stated?`, [`unclear`, `clear`]),
		};

		const evaluateQuestions = toEvaluateQuestions(questions);
		expect(evaluateQuestions.fit).toEqual({
			type: `boolean`,
			instructions: `Is this a dance event?`,
			criteria: { true: `dance`, false: `not dance` },
		});
		expect(evaluateQuestions.category.type).toBe(`choice`);
		expect(evaluateQuestions.clarity.type).toBe(`score`);

		const answers = fromEvaluateAnswers({
			fit: { type: `boolean`, probability: 0.91 },
			category: { type: `choice`, choice: `dance`, probabilities: { dance: 0.8, none: 0.2 } },
			clarity: { type: `score`, score: 1, probabilities: { "0": 0.1, "1": 0.9 } },
		});
		expect(answers.fit).toEqual({ type: `noul`, noul: 0.91 });
		expect(answers.category).toMatchObject({ type: `choice`, choice: `dance`, confidence: 0.8 });
	});
});
