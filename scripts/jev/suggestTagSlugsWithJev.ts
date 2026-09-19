import { knownTagSlugs } from "../../src/lib/eventCategories.ts";
import { stripHtml, trimAllWhitespaces } from "../../src/lib/common.ts";
import {
	CATEGORY_CONFIDENCE_THRESHOLD,
	CATEGORY_QUESTION_ID,
	FORMAT_ONLY_CATEGORY,
	MAX_TAG_SLUGS,
	NONE_CATEGORY,
	TAG_NOUL_THRESHOLD,
	slugFromQuestionId,
} from "./constants.ts";
import { buildClassificationQuestions, buildTagQuestions, uniqueTagSlugsForCategories } from "./tagQuestions.ts";
import type { SystemOneFn } from "./jevClient.ts";
import type { ChoiceResponse, NoulResponse, Questions, SystemOneResult } from "@typesafe-ai/sdk";

export async function suggestTagSlugsWithJev({
	name,
	description,
	systemOne,
	noulThreshold = TAG_NOUL_THRESHOLD,
	categoryConfidenceThreshold = CATEGORY_CONFIDENCE_THRESHOLD,
}: {
	name: string;
	description?: string | null;
	systemOne: SystemOneFn;
	noulThreshold?: number;
	categoryConfidenceThreshold?: number;
}): Promise<JevTagSuggestion> {
	const state = {
		name,
		description: trimAllWhitespaces(stripHtml(description ?? ``)) ?? ``,
	};
	const started = performance.now();
	const usage = { input_tokens: 0, output_tokens: 0 };
	let model = ``;

	const classificationQuestions = buildClassificationQuestions();
	const classification = await systemOne({
		state,
		questions: classificationQuestions,
	});
	addUsage(usage, classification.usage);
	model = classification.model;

	const categoryAnswer = classification.answers[CATEGORY_QUESTION_ID] as ChoiceResponse;
	const beamedCategories = categoriesToScore({
		choice: categoryAnswer.choice,
		probabilities: categoryAnswer.probabilities as Record<string, number>,
		confidence: categoryAnswer.confidence,
		threshold: categoryConfidenceThreshold,
	});

	const scores: { slug: string; noul: number }[] = [];
	collectNouls({
		answers: classification.answers,
		prefix: `format:`,
		threshold: noulThreshold,
		into: scores,
	});

	if (beamedCategories.length) {
		const tagQuestions = buildTagQuestions({ categorySlugs: beamedCategories });
		if (Object.keys(tagQuestions).length) {
			const tagResult = await systemOne({
				state,
				questions: tagQuestions,
			});
			addUsage(usage, tagResult.usage);
			model = tagResult.model;
			collectNouls({
				answers: tagResult.answers,
				prefix: `tag:`,
				threshold: noulThreshold,
				into: scores,
			});
		}
	}

	scores.sort((left, right) => right.noul - left.noul);
	const slugs = knownTagSlugs(scores.slice(0, MAX_TAG_SLUGS).map((item) => item.slug));

	return {
		slugs,
		category: categoryAnswer.choice,
		categoryConfidence: categoryAnswer.confidence,
		beamedCategories,
		scores,
		model,
		usage,
		latencyMs: performance.now() - started,
	};
}

export function categoriesToScore({
	choice,
	probabilities,
	confidence,
	threshold,
}: {
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
	threshold: number;
}) {
	if (choice === NONE_CATEGORY || choice === FORMAT_ONLY_CATEGORY) return [];
	if (confidence >= threshold) return uniqueTagSlugsForCategories([choice]).length ? [choice] : [];

	const ranked = Object.entries(probabilities)
		.filter(([key]) => key !== NONE_CATEGORY && key !== FORMAT_ONLY_CATEGORY)
		.sort((left, right) => right[1] - left[1])
		.slice(0, 3)
		.map(([key]) => key)
		.filter((key) => uniqueTagSlugsForCategories([key]).length);
	return ranked;
}

function collectNouls({
	answers,
	prefix,
	threshold,
	into,
}: {
	answers: SystemOneResult<Questions>[`answers`];
	prefix: string;
	threshold: number;
	into: { slug: string; noul: number }[];
}) {
	for (const [questionId, answer] of Object.entries(answers)) {
		if (!questionId.startsWith(prefix)) continue;
		if (answer.type !== `noul`) continue;
		const noulValue = (answer as NoulResponse).noul;
		if (noulValue < threshold) continue;
		into.push({ slug: slugFromQuestionId(questionId), noul: noulValue });
	}
}

function addUsage(target: { input_tokens: number; output_tokens: number }, usage?: { input_tokens?: number; output_tokens?: number }) {
	target.input_tokens += usage?.input_tokens ?? 0;
	target.output_tokens += usage?.output_tokens ?? 0;
}

type JevTagSuggestion = {
	slugs: string[];
	category: string;
	categoryConfidence: number;
	beamedCategories: string[];
	scores: { slug: string; noul: number }[];
	model: string;
	usage: { input_tokens: number; output_tokens: number };
	latencyMs: number;
};
