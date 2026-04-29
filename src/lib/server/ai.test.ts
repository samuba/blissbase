import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { aiExtractEventData, normalizeDescription } from './ai';

const model = process.env.OPENAI_API_KEY ? `gpt-5.4-nano` : undefined;
const itWithAiKey = model ? it : it.skip;

describe(`normalizeDescription`, () => {
	it(`removes a normalized leading event name`, () => {
		const result = normalizeDescription({
			description: `𝐄𝐦𝐛𝐨𝐝𝐢𝐞𝐝 Consent Lab

Join us for a WhatsApp-only event.`,
			name: `Embodied Consent Lab`
		});

		expect(result).toBe(`Join us for a WhatsApp-only event.`);
	});

	it(`does not remove a leading name when it is part of a sentence`, () => {
		const description = `Embodied Consent Laboratory is a different phrase.`;

		const result = normalizeDescription({
			description,
			name: `Embodied Consent Lab`
		});

		expect(result).toBe(description);
	});

	it(`escapes generated links for html rendering`, () => {
		const result = normalizeDescription({
			description: `More: https://example.com/?q="bad"&x=1`,
			name: null
		});

		expect(result).toBe(
			`More: <a href="https://example.com/?q=&quot;bad&quot;&amp;x=1">https://example.com/?q="bad"&amp;x=1</a>`
		);
	});

	it(`leaves existing anchor tags untouched while linkifying bare urls`, () => {
		const result = normalizeDescription({
			description: `Already <a href="https://example.com">https://example.com</a>\nMore: https://else.test.`,
			name: null
		});

		expect(result).toBe(
			`Already <a href="https://example.com">https://example.com</a>\nMore: <a href="https://else.test">https://else.test</a>.`
		);
	});

	it(`preserves already encoded entities and strips broader trailing punctuation`, () => {
		const result = normalizeDescription({
			description: `See https://example.com/?a=1&amp;b=2; or https://x.test/path].`,
			name: null
		});

		expect(result).toBe(
			`See <a href="https://example.com/?a=1&amp;b=2">https://example.com/?a=1&amp;b=2</a>; or <a href="https://x.test/path">https://x.test/path</a>].`
		);
	});

	it(`removes leading event name when followed by an em-dash, en-dash, or period`, () => {
		const emDashResult = normalizeDescription({
			description: `Embodied Consent Lab — Join us tonight.`,
			name: `Embodied Consent Lab`
		});
		expect(emDashResult).toBe(`Join us tonight.`);

		const enDashResult = normalizeDescription({
			description: `Embodied Consent Lab – Join us tonight.`,
			name: `Embodied Consent Lab`
		});
		expect(enDashResult).toBe(`Join us tonight.`);

		const periodResult = normalizeDescription({
			description: `Embodied Consent Lab. Join us tonight.`,
			name: `Embodied Consent Lab`
		});
		expect(periodResult).toBe(`Join us tonight.`);
	});
});

describe(`aiExtractEventData`, () => {
	itWithAiKey(
		`detects an existing source link and skips event extraction`,
		async () => {
			if (!model) throw new Error(`AI API key is required for this test`);

			const existingSourceResult = await aiExtractEventData({
				message: `Sharing this here:
https://sei.jetzt/event/ecstatic-dance-berlin

Looks nice for anyone interested.`,
				messageDate: new Date(`2026-04-29T06:00:00.000Z`),
				timezone: `Europe/Berlin`,
				model,
				eventIsDefinitelyConscious: false
			});

			expect(existingSourceResult).toMatchObject({
				hasEventData: false,
				existingSource: expect.stringContaining(`sei.jetzt`)
			});
			expect(existingSourceResult.name).toBeUndefined();
			expect(existingSourceResult.description).toBeUndefined();
		},
		90_000
	);

	itWithAiKey(
		`extracts rich event fields and obeys URL/contact guardrails`,
		async () => {
			if (!model) throw new Error(`AI API key is required for this test`);

			const result = await aiExtractEventData({
				message: `*Einladung zum 𝐄𝐦𝐛𝐨𝐝𝐢𝐞𝐝 Consent Lab in Berlin*

Embodied Consent Lab

Join us for a WhatsApp-only event called "Embodied Consent Lab" at The Practice Room.
The facilitator says: "Bring a blanket, water, and curiosity." 🌿
Keep this html break exactly: first line<br>second line

Date: May 21, 2026
Time: 19:00 - 21:00
Location: The Practice Room, Schönhauser Allee 10, Berlin
Attendance: offline+online (hybrid). Both in-person attendance and online attendance are possible.
Price: This sliding scale is intentionally too long to extract cleanly because it includes many details, exceptions, donation notes, discounts, support options, and follow-up arrangements that exceed one hundred characters.
Event page: https://example.com/embodied-consent
Do not use this map as the event URL: https://maps.google.com/?q=The+Practice+Room
Do not use this Telegram link as the event URL: https://t.me/example_channel
Register: hello@example.com
WhatsApp questions: +49123456789
Message me only if both registration links fail.`,
				messageDate: new Date(`2026-04-29T06:00:00.000Z`),
				timezone: `Europe/Berlin`,
				model,
				eventIsDefinitelyConscious: true
			});

			expect(result.hasEventData).toBe(true);
			expect(result.name).toBe(`Embodied Consent Lab`);
			expect(result.description).not.toMatch(/^Embodied Consent Lab/);
			expect(result.description).toContain(`"Bring a blanket, water, and curiosity."`);
			expect(result.description).toContain(`🌿`);
			expect(result.description).toContain(`first line<br>second line`);
			expect(result.description).toMatch(
				/<a\s+[^>]*href=["']https:\/\/example\.com\/embodied-consent["'][^>]*>https:\/\/example\.com\/embodied-consent<\/a>/
			);
			expect(result.startDate).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
			expect(result.endDate).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
			expect(new Date(result.startDate!).toISOString()).toBe(`2026-05-21T17:00:00.000Z`);
			expect(new Date(result.endDate!).toISOString()).toBe(`2026-05-21T19:00:00.000Z`);
			expect(result.url).toBe(`https://example.com/embodied-consent`);
			expect(result.url).not.toContain(`maps.google.com`);
			expect(result.url).not.toContain(`t.me`);
			expect(result.contact).toEqual(expect.arrayContaining([`mailto:hello@example.com`]));
			expect(result.contact?.every((contact) => /^[a-z][a-z0-9+.-]*:/i.test(contact))).toBe(true);
			expect(result.contact?.some((contact) => contact.includes(`49123456789`))).toBe(true);
			expect(result.contact?.[0]).toBe(`mailto:hello@example.com`);
			expect(result.contactAuthorForMore).toBe(false);
			expect(result.price).toBeUndefined();
			expect(result.venue).toBe(`The Practice Room`);
			expect(result.address).toBe(`Schönhauser Allee 10, Berlin`);
			expect(result.attendanceMode).toBe(`offline+online`);
			expect(result.city).toBe(`Berlin`);
			expect(result.tags?.length).toBeGreaterThan(0);
			expect(result.isConscious).toBe(true);
		},
		90_000
	);
});
