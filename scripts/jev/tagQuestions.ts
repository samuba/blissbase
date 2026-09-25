import { choice, noul } from "@typesafe-ai/sdk";
import { eventCategories, eventFormats, allTagsBySlug } from "../../src/lib/eventCategories.ts";
import { CATEGORY_QUESTION_ID, FORMAT_ONLY_CATEGORY, NONE_CATEGORY, formatQuestionId, tagQuestionId } from "./constants.ts";

/**
 * Category Choice + format Nouls. Tag Nouls are built after the category answer
 * (or after a low-confidence beam) so we stay under the token budget.
 */
export function buildClassificationQuestions() {
	return {
		[CATEGORY_QUESTION_ID]: choice(
			`Which Blissbase catalog category best fits this event from its title and description? Pick one. Use format_only when only the event format is clear. Use none when nothing in the catalog fits.`,
			categoryCriteria(),
		),
		...Object.fromEntries(eventFormats.map((format) => [formatQuestionId(format.slug), tagNoul(format.slug)])),
	};
}

export function buildTagQuestions({ categorySlugs }: { categorySlugs: string[] }) {
	const questions: Record<string, ReturnType<typeof noul>> = {};
	for (const slug of uniqueTagSlugsForCategories(categorySlugs)) {
		questions[tagQuestionId(slug)] = tagNoul(slug);
	}
	return questions;
}

export function uniqueTagSlugsForCategories(categorySlugs: string[]) {
	const slugs: string[] = [];
	const seen = new Set<string>();
	for (const categorySlug of categorySlugs) {
		const category = eventCategories.find((item) => item.slug === categorySlug);
		if (!category?.tags?.length) continue;
		for (const tag of category.tags) {
			if (seen.has(tag.slug)) continue;
			seen.add(tag.slug);
			slugs.push(tag.slug);
		}
	}
	return slugs;
}

function categoryCriteria() {
	const criteria: Record<string, string> = {};
	for (const category of eventCategories) {
		const examples = category.tags
			.slice(0, 8)
			.map((tag) => tag.label)
			.join(`, `);
		criteria[category.slug] = `${category.label}. Typical tags: ${examples}`;
	}
	criteria[FORMAT_ONLY_CATEGORY] =
		`Only a format is clear (festival, retreat, workshop, course, lecture, conference, program, online) and no topical category fits.`;
	criteria[NONE_CATEGORY] = `None of the catalog categories fit the title and description.`;
	return criteria;
}

function tagNoul(slug: string) {
	const tag = allTagsBySlug.get(slug);
	const label = tag?.label ?? slug;
	const synonyms = tag?.synonyms?.length ? ` Also known as: ${tag.synonyms.slice(0, 4).join(`, `)}.` : ``;
	return noul(`Is this specifically a ${label} (${slug}) event?`, {
		true: `The title or description clearly names or describes ${label}.${synonyms}`,
		false: `The event is not about ${label}, or that topic is only mentioned in passing.`,
	});
}
