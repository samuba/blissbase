import { slugify } from './common';
import { slugsForTagInput } from './eventCategories';
import { allTags as legacyTagTranslations } from './server/tags';

const aliasMap = buildLegacyAliasMap();

/**
 * Maps legacy `events.tags` labels (en/de/nl, mixed case, already-slugified) to catalog slugs.
 *
 * @example
 * legacyTagsToSlugs([`Yoga`, `Atemarbeit`, `Last Minute`])
 */
export function legacyTagsToSlugs(tags?: string[] | null) {
	if (!tags?.length) return [];

	const slugs: string[] = [];
	const seen = new Set<string>();
	for (const tag of tags) {
		for (const slug of resolveLegacyTag(tag)) {
			if (seen.has(slug)) continue;
			seen.add(slug);
			slugs.push(slug);
		}
	}
	return slugs;
}

/**
 * Returns trimmed legacy tags that do not resolve to any catalog slug.
 *
 * @example
 * unmatchedLegacyTags([`Yoga`, `Last Minute`])
 */
export function unmatchedLegacyTags(tags?: string[] | null) {
	if (!tags?.length) return [];
	return tags.filter((tag) => tag.trim() && !resolveLegacyTag(tag).length);
}

function resolveLegacyTag(tag: string) {
	const trimmed = tag.trim();
	if (!trimmed) return [];

	const slugs: string[] = [];
	const seen = new Set<string>();
	addSlugs(slugs, seen, slugsForTagInput(trimmed));
	addSlugs(slugs, seen, aliasMap.get(trimmed.toLowerCase()) ?? aliasMap.get(slugify(trimmed)) ?? []);
	addSlugs(slugs, seen, resolveCompoundParts(trimmed));
	return slugs;
}

function resolveCompoundParts(tag: string) {
	const parts = tag.split(/\s*(?:,|\/|\bund\b)\s*/i).map((part) => part.trim()).filter(Boolean);
	if (parts.length < 2) return [];

	const slugs: string[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		addSlugs(slugs, seen, slugsForTagInput(part));
		addSlugs(slugs, seen, aliasMap.get(part.toLowerCase()) ?? aliasMap.get(slugify(part)) ?? []);
	}
	return slugs;
}

function addSlugs(slugs: string[], seen: Set<string>, values: string[]) {
	for (const slug of values) {
		if (seen.has(slug)) continue;
		seen.add(slug);
		slugs.push(slug);
	}
}

function buildLegacyAliasMap() {
	const aliases = new Map<string, string[]>();

	for (const translation of uniqueLegacyTranslations()) {
		const slugs = [
			...slugsForTagInput(translation.en),
			...slugsForTagInput(translation.de),
			...slugsForTagInput(translation.nl),
		];
		const known = [...new Set(slugs)];
		if (!known.length) continue;
		addAlias(aliases, translation.en, known);
		addAlias(aliases, translation.de, known);
		addAlias(aliases, translation.nl, known);
	}

	return aliases;
}

function uniqueLegacyTranslations() {
	const byEnglish = new Map<string, LegacyTagTranslation>();
	for (const translation of legacyTagTranslations) {
		if (byEnglish.has(translation.en)) continue;
		byEnglish.set(translation.en, translation);
	}
	return [...byEnglish.values()];
}

function addAlias(aliases: Map<string, string[]>, rawKey: string, slugs: string[]) {
	if (!slugs.length) return;

	for (const key of [rawKey.trim().toLowerCase(), slugify(rawKey)].filter(Boolean)) {
		const existing = aliases.get(key);
		if (!existing) {
			aliases.set(key, slugs);
			continue;
		}
		aliases.set(key, [...new Set([...existing, ...slugs])]);
	}
}

type LegacyTagTranslation = {
	en: string;
	de: string;
	nl: string;
};
