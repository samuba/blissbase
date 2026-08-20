import { aiSuggestTagSlugs } from '../src/lib/server/ai.ts';
import { sleep as defaultSleep } from './common.ts';

const AI_TAG_MAX_RETRIES = 5;
const AI_TAG_BACKOFF_CAP_MS = 10_000;

/**
 * Fills empty `tagSlugs` on scraped events via AI. Already tagged rows are skipped.
 * Events that share name, host, source, and address share one AI call.
 * @example
 * fillMissingEventTagSlugs({ events: upserted, updateTagSlugs })
 */
export async function fillMissingEventTagSlugs({
	events,
	suggestTagSlugs = aiSuggestTagSlugs,
	updateTagSlugs,
	concurrency = 5,
	sleep = defaultSleep,
}: {
	events: EventToTag[];
	suggestTagSlugs?: (args: { name: string; description?: string | null }) => Promise<string[]>;
	updateTagSlugs: (args: { ids: number[]; tagSlugs: string[] }) => Promise<void>;
	concurrency?: number;
	sleep?: (ms: number) => Promise<unknown>;
}) {
	let tagged = 0;
	let skipped = 0;
	let failed = 0;

	const untagged: EventToTag[] = [];
	for (const event of events) {
		if (event.tagSlugs?.length) {
			skipped += 1;
			continue;
		}
		untagged.push(event);
	}

	const groups = groupEventsForTagging(untagged);
	for (let i = 0; i < groups.length; i += concurrency) {
		const batch = groups.slice(i, i + concurrency);
		await Promise.all(
			batch.map(async (group) => {
				const ids = group.map((event) => event.id);
				try {
					const representative = pickRepresentativeEvent(group);
					const tagSlugs = await suggestTagSlugsWithRetry({
						suggestTagSlugs,
						name: representative.name,
						description: representative.description,
						sleep,
					});
					if (!tagSlugs.length) return;
					await updateTagSlugs({ ids, tagSlugs });
					tagged += ids.length;
				} catch (error) {
					failed += ids.length;
					console.error(
						`Failed to tag event "${group[0].name}" (ids ${ids.join(`, `)}):`,
						error,
					);
				}
			}),
		);
	}

	console.log(
		`Tag slugs: tagged ${tagged} events, skipped ${skipped} already tagged, failed ${failed}`,
	);
	return { tagged, skipped, failed };
}

async function suggestTagSlugsWithRetry({
	suggestTagSlugs,
	name,
	description,
	sleep,
}: {
	suggestTagSlugs: (args: { name: string; description?: string | null }) => Promise<string[]>;
	name: string;
	description?: string | null;
	sleep: (ms: number) => Promise<unknown>;
}) {
	let lastError: unknown;
	for (let attempt = 0; attempt <= AI_TAG_MAX_RETRIES; attempt++) {
		try {
			if (attempt > 0) {
				const backoffDelay = Math.min(1000 * 2 ** (attempt - 1), AI_TAG_BACKOFF_CAP_MS);
				console.warn(
					`Retrying tag slugs for "${name}" (${attempt}/${AI_TAG_MAX_RETRIES}) after ${backoffDelay}ms`,
				);
				await sleep(backoffDelay);
			}
			return await suggestTagSlugs({ name, description });
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

function groupEventsForTagging(events: EventToTag[]) {
	const groups = new Map<string, EventToTag[]>();
	for (const event of events) {
		const key = eventTagGroupKey(event);
		const group = groups.get(key);
		if (group) {
			group.push(event);
			continue;
		}
		groups.set(key, [event]);
	}
	return [...groups.values()];
}

function eventTagGroupKey(event: EventToTag) {
	return `${event.name}\0${event.host ?? ``}\0${event.source ?? ``}\0${addressGroupKey(event.address)}`;
}

function addressGroupKey(address?: string[] | null) {
	if (!address?.length) return ``;
	return address.map((line) => line.trim()).join(`\0`);
}

function pickRepresentativeEvent(events: EventToTag[]) {
	let best = events[0];
	let bestLength = eventDescriptionLength(best);
	for (const event of events.slice(1)) {
		const length = eventDescriptionLength(event);
		if (length <= bestLength) continue;
		best = event;
		bestLength = length;
	}
	return best;
}

function eventDescriptionLength(event: EventToTag) {
	return event.description?.length ?? 0;
}

type EventToTag = {
	id: number;
	name: string;
	description?: string | null;
	host?: string | null;
	source?: string | null;
	address?: string[] | null;
	tagSlugs?: string[] | null;
};
