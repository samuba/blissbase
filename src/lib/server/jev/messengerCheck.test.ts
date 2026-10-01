import { beforeEach, describe, expect, it, vi } from "vitest";
import { broadestTagSlugs } from "../../eventCategories";
import { JEV_CLOSED_EXTRACTION_FIELDS, type AiExtractEventDataArgs } from "../ai";

const extract = vi.hoisted(() => vi.fn());
const transcribe = vi.hoisted(() => vi.fn());
const systemOne = vi.hoisted(() => vi.fn());

vi.mock("../ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ai")>()),
	aiExtractEventData: extract,
	aiTranscribeImage: transcribe,
}));

vi.mock("@typesafe-ai/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@typesafe-ai/sdk")>()),
	TypeSafeClient: class {
		systemOne = systemOne;
	},
}));

import { interpretJevAnswer, messageTextForJev, resolveMessengerAnalysis } from "./messengerCheck";

const baseArgs = {
	messageDate: new Date(`2026-09-01T12:00:00.000Z`),
	timezone: `Europe/Berlin`,
	eventIsDefinitelyConscious: false,
} satisfies Omit<AiExtractEventDataArgs, "message">;

describe(`interpretJevAnswer`, () => {
	it(`skips when the message is not an event, has no start date, or is not conscious`, () => {
		expect(interpretJevAnswer({ answers: answers({ is_event: 0.2 }), eventIsDefinitelyConscious: false })).toEqual({
			skipReason: `not an event announcement`,
		});
		expect(interpretJevAnswer({ answers: answers({ has_start_date: 0.2 }), eventIsDefinitelyConscious: false })).toEqual({
			skipReason: `no start date`,
		});
		expect(interpretJevAnswer({ answers: answers({ is_conscious: 0.2 }), eventIsDefinitelyConscious: false })).toEqual({
			skipReason: `not a conscious event`,
		});
	});

	it(`keeps a conscious-only chat even when the conscious noul is low`, () => {
		const judgment = interpretJevAnswer({ answers: answers({ is_conscious: 0.1 }), eventIsDefinitelyConscious: true });
		expect(judgment).toMatchObject({ tags: expect.any(Array) });
		expect(judgment).not.toHaveProperty(`skipReason`);
	});

	it(`keeps tags whose noul is yes, strongest first`, () => {
		const judgment = interpretJevAnswer({
			answers: answers({
				attendance: { type: `choice`, choice: `online`, confidence: 0.86 },
				contact_author: 0.8,
				dance: 0.91,
				yoga: 0.72,
				ceremony: 0.61,
				music: 0.2,
			}),
			eventIsDefinitelyConscious: false,
		});
		expect(judgment).toMatchObject({
			attendanceMode: `online`,
			contactAuthorForMore: true,
			tags: [`dance`, `yoga`, `ceremony`],
			omitFields: JEV_CLOSED_EXTRACTION_FIELDS,
		});
	});

	it(`defaults attendance to offline when the choice is unsure`, () => {
		const judgment = interpretJevAnswer({
			answers: answers({ attendance: { type: `choice`, choice: `online`, confidence: 0.2 } }),
			eventIsDefinitelyConscious: false,
		});
		expect(judgment).toMatchObject({ attendanceMode: `offline` });
	});

	it(`sets a confident event structure on its own field`, () => {
		const judgment = interpretJevAnswer({
			answers: answers({ dance: 0.9, event_structure: { type: `choice`, choice: `session`, confidence: 0.8 } }),
			eventIsDefinitelyConscious: false,
		});
		expect(judgment).toMatchObject({ tags: [`dance`], structure: `session` });
	});

	it(`omits the event structure when the choice is none or unsure`, () => {
		const none = interpretJevAnswer({
			answers: answers({ event_structure: { type: `choice`, choice: `none`, confidence: 0.9 } }),
			eventIsDefinitelyConscious: false,
		});
		const unsure = interpretJevAnswer({
			answers: answers({ event_structure: { type: `choice`, choice: `retreat`, confidence: 0.2 } }),
			eventIsDefinitelyConscious: false,
		});
		expect(none).toMatchObject({ tags: [] });
		expect(unsure).toMatchObject({ tags: [] });
		expect(none.structure).toBeUndefined();
		expect(unsure.structure).toBeUndefined();
	});

	it(`sets a confident event language on its own field`, () => {
		const judgment = interpretJevAnswer({
			answers: answers({ language: { type: `choice`, choice: `german`, confidence: 0.8 } }),
			eventIsDefinitelyConscious: false,
		});
		expect(judgment).toMatchObject({ language: `german` });
	});

	it(`omits the event language when the choice is unsure`, () => {
		const unsure = interpretJevAnswer({
			answers: answers({ language: { type: `choice`, choice: `english`, confidence: 0.2 } }),
			eventIsDefinitelyConscious: false,
		});
		expect(unsure.language).toBeUndefined();
	});
});

describe(`resolveMessengerAnalysis`, () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		extract.mockReset();
		transcribe.mockReset();
		systemOne.mockReset();
		extract.mockResolvedValue({
			hasEventData: true,
			name: `Ecstatic Dance`,
			startDate: `2026-10-02T17:00:00.000Z`,
			description: `Barefoot.`,
		});
		systemOne.mockResolvedValue({ answers: answers({}) });
	});

	it(`skips the LLM when Jev says the message is not an event`, async () => {
		systemOne.mockResolvedValue({ answers: answers({ is_event: 0.1 }) });
		const beforeLlmExtract = vi.fn();
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `Anyone know a good café?`, beforeLlmExtract });
		expect(result).toEqual({ hasEventData: false });
		expect(extract).not.toHaveBeenCalled();
		expect(beforeLlmExtract).not.toHaveBeenCalled();
	});

	it(`judges the html-free text, omits the fields Jev answered and applies its judgment`, async () => {
		systemOne.mockResolvedValue({
			answers: answers({
				dance: 0.9,
				attendance: { type: `choice`, choice: `online`, confidence: 0.9 },
				language: { type: `choice`, choice: `german`, confidence: 0.8 },
			}),
		});
		const beforeLlmExtract = vi.fn();
		const message = `<b>Ecstatic Dance</b> Berlin<br>Freitag, 2. Oktober 2026, 19:00. Nur online.`;
		const result = await resolveMessengerAnalysis({ ...baseArgs, message, beforeLlmExtract });

		expect(systemOne.mock.calls[0]?.[0].state.message).toBe(`Ecstatic Dance Berlin\nFreitag, 2. Oktober 2026, 19:00. Nur online.`);
		expect(beforeLlmExtract).toHaveBeenCalledOnce();
		const passed = extract.mock.calls[0]?.[0] as AiExtractEventDataArgs;
		expect(passed.message).toBe(message);
		expect(passed.omitFields).toEqual(JEV_CLOSED_EXTRACTION_FIELDS);
		expect(result).toMatchObject({
			hasEventData: true,
			isConscious: true,
			name: `Ecstatic Dance`,
			tags: [`dance`],
			attendanceMode: `online`,
			contactAuthorForMore: false,
			language: `german`,
		});
		expect(result.existingSource).toBeUndefined();
	});

	it(`falls back to the full extraction when Jev fails`, async () => {
		const warn = vi.spyOn(console, `warn`).mockImplementation(() => {});
		systemOne.mockRejectedValue(new Error(`jev down`));
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `Ecstatic Dance am Freitag` });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(`messenger check failed`), expect.any(Error));
		expect(extract).toHaveBeenCalledOnce();
		expect(extract.mock.calls[0]?.[0]).not.toHaveProperty(`omitFields`);
		expect(result.name).toBe(`Ecstatic Dance`);
	});

	it(`keeps the extractor answer when it finds no event`, async () => {
		extract.mockResolvedValue({ hasEventData: false });
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `Ecstatic Dance am Freitag` });
		expect(result).toEqual({ hasEventData: false });
	});

	it(`keeps an existing source found during extraction`, async () => {
		extract.mockResolvedValue({ hasEventData: false, existingSource: `sei.jetzt` });
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `Ecstatic Dance am Freitag` });
		expect(result).toEqual({ hasEventData: false, existingSource: `sei.jetzt` });
	});

	it(`does not judge or extract when the message already points at a scraped source`, async () => {
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `Siehe https://sei.jetzt/event/ecstatic-dance-berlin` });
		expect(systemOne).not.toHaveBeenCalled();
		expect(extract).not.toHaveBeenCalled();
		expect(transcribe).not.toHaveBeenCalled();
		expect(result.existingSource).toContain(`sei.jetzt`);
	});

	it(`extracts without Jev when the message has no text`, async () => {
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: `   ` });
		expect(systemOne).not.toHaveBeenCalled();
		expect(extract).toHaveBeenCalledOnce();
		expect(extract.mock.calls[0]?.[0]).not.toHaveProperty(`omitFields`);
		expect(result.name).toBe(`Ecstatic Dance`);
	});

	it(`transcribes an image, judges caption plus transcript, then extracts without the image`, async () => {
		transcribe.mockResolvedValue(`Ecstatic Dance Berlin\nFreitag, 2. Oktober 2026, 19:00`);
		await resolveMessengerAnalysis({ ...baseArgs, message: `See the image`, imageInputs: [`https://example.com/image.jpg`] });

		expect(transcribe).toHaveBeenCalledWith({ imageInputs: [`https://example.com/image.jpg`] });
		expect(systemOne.mock.calls[0]?.[0].state.message).toBe(`See the image\n\nEcstatic Dance Berlin\nFreitag, 2. Oktober 2026, 19:00`);
		const passed = extract.mock.calls[0]?.[0] as AiExtractEventDataArgs;
		expect(passed.imageInputs).toEqual([]);
		expect(passed.message).toContain(`Freitag, 2. Oktober 2026`);
		expect(passed.omitFields).toEqual(JEV_CLOSED_EXTRACTION_FIELDS);
	});

	it(`skips the extraction when Jev rejects the image transcript`, async () => {
		transcribe.mockResolvedValue(`Ecstatic Dance Berlin is happening again soon.`);
		systemOne.mockResolvedValue({ answers: answers({ has_start_date: 0.1 }) });
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: ``, imageInputs: [`https://example.com/image.jpg`] });
		expect(result).toEqual({ hasEventData: false });
		expect(extract).not.toHaveBeenCalled();
	});

	it(`uses the full image extraction path when image transcription fails`, async () => {
		const warn = vi.spyOn(console, `warn`).mockImplementation(() => {});
		transcribe.mockRejectedValue(new Error(`vision down`));
		await resolveMessengerAnalysis({ ...baseArgs, message: `See the image`, imageInputs: [`https://example.com/image.jpg`] });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(`image transcription failed`), expect.any(Error));
		const passed = extract.mock.calls[0]?.[0] as AiExtractEventDataArgs;
		expect(passed.message).toBe(`See the image`);
		expect(passed.imageInputs).toEqual([`https://example.com/image.jpg`]);
		expect(passed.omitFields).toBeUndefined();
	});

	it(`skips when the image transcript points at a scraped source`, async () => {
		transcribe.mockResolvedValue(`Siehe https://sei.jetzt/event/ecstatic-dance-berlin`);
		const result = await resolveMessengerAnalysis({ ...baseArgs, message: ``, imageInputs: [`https://example.com/image.jpg`] });
		expect(extract).not.toHaveBeenCalled();
		expect(result.existingSource).toContain(`sei.jetzt`);
	});
});

describe(`messageTextForJev`, () => {
	it(`strips html before the judgment`, () => {
		expect(messageTextForJev(`<b>Ecstatic Dance</b><br>Freitag`)).toBe(`Ecstatic Dance\nFreitag`);
	});
});

function answers(overrides: Record<string, number | Record<string, unknown>>) {
	const built: Record<string, unknown> = {
		is_event: { type: `noul`, noul: 0.9 },
		has_start_date: { type: `noul`, noul: 0.9 },
		is_conscious: { type: `noul`, noul: 0.9 },
		contact_author: { type: `noul`, noul: 0.2 },
		attendance: { type: `choice`, choice: `offline`, confidence: 0.8 },
		language: { type: `choice`, choice: `other`, confidence: 0.8 },
		event_structure: { type: `choice`, choice: `none`, confidence: 0.8 },
	};
	for (const slug of broadestTagSlugs) built[slug] = { type: `noul`, noul: 0.1 };
	for (const [id, value] of Object.entries(overrides)) {
		built[id] = typeof value === `number` ? { type: `noul`, noul: value } : value;
	}
	return built as Parameters<typeof interpretJevAnswer>[0][`answers`];
}
