export const JEV_PINNED_VERSION = `jev-1.13.0`;
export const JEV_GATEWAY_MODEL = `typesafe-ai/jev`;
export const JEV_GATEWAY_EVALUATE_URL = `https://ai-gateway.vercel.sh/v4/ai/evaluation-model`;

export const TAG_NOUL_THRESHOLD = 0.6;
export const CATEGORY_CONFIDENCE_THRESHOLD = 0.45;
export const MAX_TAG_SLUGS = 4;
export const GOLD_SET_SIZE = 200;
export const GOLD_SET_LANGUAGE_TARGETS = {
	de: 170,
	en: 20,
	id: 10,
} as const;

export const CATEGORY_QUESTION_ID = `category`;
export const FORMAT_ONLY_CATEGORY = `format_only`;
export const NONE_CATEGORY = `none`;

export function formatQuestionId(slug: string) {
	return `format:${slug}`;
}

export function tagQuestionId(slug: string) {
	return `tag:${slug}`;
}

export function slugFromQuestionId(questionId: string) {
	const separator = questionId.indexOf(`:`);
	if (separator < 0) return questionId;
	return questionId.slice(separator + 1);
}
