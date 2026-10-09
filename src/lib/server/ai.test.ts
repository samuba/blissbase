import { describe, expect, it } from 'vitest';
import { aiExtractEventData, aiTranscribeImage, ensureAddressIncludesCity, getExistingSource, keptExtractionFields, normalizeDescription } from './ai';

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
			`Already <a href="https://example.com">https://example.com</a><br>More: <a href="https://else.test">https://else.test</a>.`
		);
	});

	it(`prefixes https on anchor hrefs that lack a scheme`, () => {
		const result = normalizeDescription({
			description: `See <a href="example.com/path">example.com/path</a> or <a href='www.x.test'>x</a>`,
			name: null
		});

		expect(result).toBe(
			`See <a href="https://example.com/path">example.com/path</a> or <a href='https://www.x.test'>x</a>`
		);
	});

	it(`keeps mailto, tel, and already-schemed hrefs as-is`, () => {
		const description = `Mail <a href="mailto:hi@x.test">hi</a>, call <a href="tel:+123">call</a>, web <a href="http://x.test">x</a>`;
		expect(normalizeDescription({ description, name: null })).toBe(description);
	});

	it(`converts plain-text line breaks to br tags`, () => {
		const result = normalizeDescription({
			description: `Line 1\nLine 2\n\n\nLine 3`,
			name: null
		});

		expect(result).toBe(`Line 1<br>Line 2<br><br>Line 3`);
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

describe(`ensureAddressIncludesCity`, () => {
	it(`appends the city when the street line dropped it`, () => {
		expect(
			ensureAddressIncludesCity({
				address: `Schönhauser Allee 10`,
				city: `Berlin`
			})
		).toBe(`Schönhauser Allee 10, Berlin`);
	});

	it(`leaves an address that already contains the city`, () => {
		expect(
			ensureAddressIncludesCity({
				address: `Schönhauser Allee 10, Berlin`,
				city: `Berlin`
			})
		).toBe(`Schönhauser Allee 10, Berlin`);
	});
});

describe(`getExistingSource`, () => {
	it(`detects configured source links from message text`, () => {
		expect(getExistingSource(`Sharing https://sei.jetzt/event/ecstatic-dance-berlin`)).toBe(
			`sei.jetzt`
		);
		expect(getExistingSource(`See https://www.heilnetz-owl.de/termine/demo`)).toBe(
			`heilnetz-owl.de`
		);
		expect(getExistingSource(`Wrapped (https://sei.jetzt).`)).toBe(`sei.jetzt`);
	});

	it(`ignores excluded sources and lookalike hosts`, () => {
		expect(getExistingSource(`Tickets: https://megatix.co.id/events/demo`)).toBeUndefined();
		expect(getExistingSource(`Fake: https://sei.jetzt.evil.test/event/demo`)).toBeUndefined();
	});
});

describe(`keptExtractionFields`, () => {
	it(`drops closed judgments Jev already answered`, () => {
		const kept = keptExtractionFields([`hasEventData`, `tags`, `isConscious`, `attendanceMode`, `contactAuthorForMore`]);
		expect(kept).not.toContain(`hasEventData`);
		expect(kept).not.toContain(`tags`);
		expect(kept).not.toContain(`isConscious`);
		expect(kept).not.toContain(`attendanceMode`);
		expect(kept).not.toContain(`contactAuthorForMore`);
		expect(kept).toContain(`name`);
		expect(kept).toContain(`description`);
		expect(kept).toContain(`startDate`);
		expect(kept).toContain(`emojis`);
	});
});

describe(`aiExtractEventData`, () => {
	it(
		`detects an existing source link and skips event extraction`,
		async () => {
			const existingSourceResult = await aiExtractEventData({
				message: `Sharing this here:
https://sei.jetzt/event/ecstatic-dance-berlin

Looks nice for anyone interested.`,
				messageDate: new Date(`2026-04-29T06:00:00.000Z`),
				timezone: `Europe/Berlin`,
				eventIsDefinitelyConscious: false
			});

			expect(existingSourceResult).toMatchObject({
				hasEventData: false,
				existingSource: expect.stringContaining(`sei.jetzt`)
			});
			expect(existingSourceResult.name).toBeUndefined();
			expect(existingSourceResult.description).toBeUndefined();
		}
	);
});

describe(`aiTranscribeImage`, () => {
	it(`throws when there is no image`, async () => {
		await expect(aiTranscribeImage({ imageInputs: [] })).rejects.toThrow(`No image to transcribe`);
	});
});
