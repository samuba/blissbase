import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { eventMessages, expectEventFields, expectJudgment, nonEventMessages, uncachedArgs } from '../../../test/fixtures/eventMessages';
import { resolveMessengerAnalysis } from './messengerCheck';

describe(`resolveMessengerAnalysis`, () => {
	for (const nonEvent of nonEventMessages) {
		it.concurrent(`skips ${nonEvent.name}`, { timeout: 30_000, retry: 2 }, async () => {
			expect(await resolveMessengerAnalysis(uncachedArgs(nonEvent))).toEqual({ hasEventData: false });
		});
	}

	for (const eventMessage of eventMessages) {
		it.concurrent(`extracts ${eventMessage.name} with Jev judgments`, { timeout: 120_000, retry: 2 }, async () => {
			const result = await resolveMessengerAnalysis(uncachedArgs(eventMessage));
			expectJudgment(result, eventMessage.judgment);
			expectEventFields(result, eventMessage.fields);
		});
	}
});
