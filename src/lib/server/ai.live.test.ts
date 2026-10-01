import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { eventMessages, expectEventFields, uncachedArgs } from '../../test/fixtures/eventMessages';
import { imageTranscriptCases, readFixtureImages } from '../../test/fixtures/image-transcripts/cases';
import { expectLines } from '../../test/transcriptLines';
import { aiExtractEventData, aiTranscribeImage } from './ai';

describe(`aiExtractEventData`, () => {
	for (const eventMessage of eventMessages) {
		it.concurrent(`extracts ${eventMessage.name}`, { timeout: 90_000, retry: 2 }, async () => {
			const result = await aiExtractEventData(uncachedArgs(eventMessage));

			expectEventFields(result, eventMessage.fields);
			expect(result.attendanceMode).toBe(eventMessage.judgment.attendanceMode);
			expect(result.contactAuthorForMore).toBe(eventMessage.judgment.contactAuthorForMore);
			expect(result.tags?.length).toBeGreaterThan(0);
		});
	}
});

describe(`aiTranscribeImage`, () => {
	for (const transcriptCase of imageTranscriptCases) {
		it.concurrent(`transcribes ${transcriptCase.name}`, { timeout: 180_000, retry: 2 }, async () => {
			const transcript = await aiTranscribeImage({ imageInputs: await readFixtureImages(transcriptCase.files) });
			expectLines(transcript, transcriptCase.lines);
		});
	}
});
