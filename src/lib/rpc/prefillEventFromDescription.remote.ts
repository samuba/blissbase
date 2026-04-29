import * as v from 'valibot';
import { command } from '$app/server';
import { ensureUserId } from '$lib/server/common';
import { aiExtractEventData } from '../server/ai';
import { mapAiAnswerToCreateEventPrefill } from '$lib/server/mapAiAnswerToCreateEventPrefill';

const prefillSchema = v.object({
	text: v.pipe(v.string(), v.maxLength(200_000)),
	timeZone: v.pipe(v.string(), v.nonEmpty())
});

/**
 * Runs the same AI extraction as the Telegram bot on pasted text and returns form-friendly values.
 *
 * @example
 * await prefillEventFromDescription({ text: `…`, timeZone: `Europe/Berlin` });
 */
export const prefillEventFromDescription = command(prefillSchema, async ({ text, timeZone }) => {
	ensureUserId({ msg: `Du musst angemeldet sein, um Events importieren zu können.` });

	const trimmed = text.trim();
	if (!trimmed) {
		return { kind: `empty` as const };
	}

	const analysis = await aiExtractEventData({ message: trimmed, messageDate: new Date(), timezone: timeZone, model: `gpt-5.4-nano`, eventIsDefinitelyConscious: true });
	const fields = await mapAiAnswerToCreateEventPrefill(analysis);
	return { kind: `ok` as const, fields };
});
