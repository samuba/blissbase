import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { aiExtractEventData } from './ai';

const model = process.env.OPENAI_API_KEY ? `gpt-5-mini` : undefined;
const itWithAiKey = model ? it : it.skip;

describe(`aiExtractEventData`, () => {
	itWithAiKey(
		`extracts a WhatsApp event message with quotes in the description`,
		async () => {
			if (!model) throw new Error(`AI API key is required for this test`);
			console.time("extraction with " + model + " took")
			const result = await aiExtractEventData({
				message: `*Somatic Evening: "Breath & Sound"*

Join us for a WhatsApp-only event called "Breath & Sound" at The Practice Room.
The facilitator says: "Bring a blanket, water, and curiosity."

Date: May 21, 2026
Time: 19:00 - 21:00
Location: The Practice Room, Schönhauser Allee 10, Berlin
Price: 25 EUR
Register: https://example.com/breath-sound`,
				messageDate: new Date(`2026-04-29T06:00:00.000Z`),
				timezone: `Europe/Berlin`,
				model,
				eventIsDefinitelyConscious: true
			});
			console.log("result", result)

			console.timeEnd("extraction with " + model + " took")
			expect(result.hasEventData).toBe(true);
			expect(result.description).toContain(`"`);
			expect(result.description).toContain(`Breath & Sound`);
			expect(result.startDate).toBeDefined();
		},
		45_000
	);
});
