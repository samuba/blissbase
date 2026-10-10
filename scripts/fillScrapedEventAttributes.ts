import { stripHtml, trimAllWhitespaces } from '../src/lib/common.ts';
import type { EventStructure } from '../src/lib/eventCategories.ts';
import type { EventLanguage } from '../src/lib/server/ai.ts';
import { askJevEventAttributes, interpretEventAttributes } from '../src/lib/server/jev/messengerCheck.ts';
import { sleep as defaultSleep } from './common.ts';

const AI_JUDGE_MAX_RETRIES = 5;
const AI_JUDGE_BACKOFF_CAP_MS = 10_000;

/**
 * Fills missing Jev attributes on scraped events: tagSlugs, language, structure, listed (from is_conscious).
 * Already tagged or unlisted rows are skipped. Events that share name, host, source, and address share one Jev call.
 * @example
 * fillMissingEventAttributes({ events: upserted, updateEventAttributes })
 */
export async function fillMissingEventAttributes({
	events,
	judgeEventAttributes = defaultJudgeEventAttributes,
	updateEventAttributes,
	concurrency = 5,
	sleep = defaultSleep,
}: {
	events: EventToJudge[];
	judgeEventAttributes?: (args: {
		name: string;
		description?: string | null;
	}) => Promise<EventAttributes>;
	updateEventAttributes: (args: EventAttributesUpdate) => Promise<void>;
	concurrency?: number;
	sleep?: (ms: number) => Promise<unknown>;
}) {
	let filled = 0;
	let skipped = 0;
	let failed = 0;

	const needingJudgment: EventToJudge[] = [];
	for (const event of events) {
		if (event.tagSlugs?.length || event.listed === false) {
			skipped += 1;
			continue;
		}
		needingJudgment.push(event);
	}

	const groups = groupEventsForJudgment(needingJudgment);
	for (let i = 0; i < groups.length; i += concurrency) {
		const batch = groups.slice(i, i + concurrency);
		await Promise.all(
			batch.map(async (group) => {
				const ids = group.map((event) => event.id);
				try {
					const representative = pickRepresentativeEvent(group);
					const attributes = await judgeEventAttributesWithRetry({
						judgeEventAttributes,
						name: representative.name,
						description: representative.description,
						sleep,
					});
					const update = attributesToUpdate({ ids, attributes });
					if (!update) return;
					await updateEventAttributes(update);
					filled += ids.length;
				} catch (error) {
					failed += ids.length;
					console.error(
						`Failed to judge event "${group[0].name}" (ids ${ids.join(`, `)}):`,
						error,
					);
				}
			}),
		);
	}

	console.log(
		`Event attributes: filled ${filled} events, skipped ${skipped} already tagged or unlisted, failed ${failed}`,
	);
	return { filled, skipped, failed };
}

async function defaultJudgeEventAttributes({
	name,
	description,
}: {
	name: string;
	description?: string | null;
}) {
	const descriptionText = trimAllWhitespaces(stripHtml(description ?? ``)) ?? ``;
	const text = descriptionText ? `Title: ${name}\n\nDescription: ${descriptionText}` : `Title: ${name}`;
	const { answers } = await askJevEventAttributes(text);
	const attributes = interpretEventAttributes(answers);
	console.log(`[ai] Event attributes for "${name}":`, attributes);
	return attributes;
}

function attributesToUpdate({
	ids,
	attributes,
}: {
	ids: number[];
	attributes: EventAttributes;
}): EventAttributesUpdate | undefined {
	const { tags, language, structure, isConscious } = attributes;
	if (!tags.length && language == null && structure == null && isConscious) return;
	return {
		ids,
		tagSlugs: tags,
		language,
		structure,
		listed: isConscious ? undefined : false,
	};
}

async function judgeEventAttributesWithRetry({
	judgeEventAttributes,
	name,
	description,
	sleep,
}: {
	judgeEventAttributes: (args: {
		name: string;
		description?: string | null;
	}) => Promise<EventAttributes>;
	name: string;
	description?: string | null;
	sleep: (ms: number) => Promise<unknown>;
}) {
	let lastError: unknown;
	for (let attempt = 0; attempt <= AI_JUDGE_MAX_RETRIES; attempt++) {
		try {
			if (attempt > 0) {
				const backoffDelay = Math.min(1000 * 2 ** (attempt - 1), AI_JUDGE_BACKOFF_CAP_MS);
				console.warn(
					`Retrying event attributes for "${name}" (${attempt}/${AI_JUDGE_MAX_RETRIES}) after ${backoffDelay}ms`,
				);
				await sleep(backoffDelay);
			}
			return await judgeEventAttributes({ name, description });
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

function groupEventsForJudgment(events: EventToJudge[]) {
	const groups = new Map<string, EventToJudge[]>();
	for (const event of events) {
		const key = eventJudgmentGroupKey(event);
		const group = groups.get(key);
		if (group) {
			group.push(event);
			continue;
		}
		groups.set(key, [event]);
	}
	return [...groups.values()];
}

function eventJudgmentGroupKey(event: EventToJudge) {
	return `${event.name}\0${event.host ?? ``}\0${event.source ?? ``}\0${addressGroupKey(event.address)}`;
}

function addressGroupKey(address?: string[] | null) {
	if (!address?.length) return ``;
	return address.map((line) => line.trim()).join(`\0`);
}

function pickRepresentativeEvent(events: EventToJudge[]) {
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

function eventDescriptionLength(event: EventToJudge) {
	return event.description?.length ?? 0;
}

type EventAttributes = {
	tags: string[];
	language?: EventLanguage;
	structure?: EventStructure;
	isConscious: boolean;
};

type EventAttributesUpdate = {
	ids: number[];
	tagSlugs: string[];
	language?: EventLanguage;
	structure?: EventStructure;
	listed?: false;
};

type EventToJudge = {
	id: number;
	name: string;
	description?: string | null;
	host?: string | null;
	source?: string | null;
	address?: string[] | null;
	tagSlugs?: string[] | null;
	listed?: boolean;
};
