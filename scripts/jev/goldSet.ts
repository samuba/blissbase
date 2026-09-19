import { GOLD_SET_LANGUAGE_TARGETS, GOLD_SET_SIZE } from "./constants.ts";

export function sampleGoldSet({ events, limit }: { events: GoldEvent[]; limit: number }) {
	const buckets: Record<GoldEvent[`language`], GoldEvent[]> = { de: [], en: [], id: [], other: [] };
	for (const event of events) {
		buckets[event.language].push(event);
	}

	const picked: GoldEvent[] = [];
	const enShare = Math.round((limit * GOLD_SET_LANGUAGE_TARGETS.en) / GOLD_SET_SIZE);
	const idShare = Math.round((limit * GOLD_SET_LANGUAGE_TARGETS.id) / GOLD_SET_SIZE);
	const en = Math.min(buckets.en.length, Math.max(enShare, buckets.en.length && limit >= 3 ? 1 : 0));
	const id = Math.min(buckets.id.length, Math.max(idShare, buckets.id.length && limit >= 5 ? 1 : 0), Math.max(0, limit - en));
	const de = Math.min(buckets.de.length, Math.max(0, limit - en - id));
	const targets = { de, en, id };

	for (const language of [`de`, `en`, `id`] as const) {
		picked.push(...buckets[language].slice(0, targets[language]));
	}

	if (picked.length < limit) {
		const seen = new Set(picked.map((event) => event.id));
		for (const event of events) {
			if (picked.length >= limit) break;
			if (seen.has(event.id)) continue;
			picked.push(event);
			seen.add(event.id);
		}
	}

	return picked.slice(0, limit);
}

export type GoldEvent = {
	id: number;
	name: string;
	description: string;
	tagSlugs: string[];
	source: string;
	language: `de` | `en` | `id` | `other`;
};
