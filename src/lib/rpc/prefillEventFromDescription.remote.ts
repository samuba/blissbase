import * as v from 'valibot';
import { command } from '$app/server';
import { ensureUserId } from '$lib/server/common';
import { aiExtractEventData } from '../server/ai';
import { mapAiAnswerToCreateEventPrefill } from '$lib/server/mapAiAnswerToCreateEventPrefill';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [`image/jpeg`, `image/png`, `image/webp`, `image/gif`] as const;

const prefillImageSchema = v.object({
	base64: v.pipe(v.string(), v.nonEmpty()),
	mediaType: v.picklist(ALLOWED_IMAGE_TYPES)
});

const prefillSchema = v.pipe(
	v.object({
		text: v.optional(v.pipe(v.string(), v.maxLength(200_000)), ``),
		timeZone: v.pipe(v.string(), v.nonEmpty()),
		images: v.optional(
			v.pipe(v.array(prefillImageSchema), v.maxLength(3, `Maximal 3 Bilder erlaubt`)),
			[]
		)
	}),
	v.check(
		(input) => Boolean(input.text?.trim()) || Boolean(input.images?.length),
		`Text oder Bild erforderlich`
	)
);

/**
 * Runs the same AI extraction as the Telegram bot on pasted text and/or images
 * and returns form-friendly values.
 *
 * @example
 * await prefillEventFromDescription({ text: `…`, timeZone: `Europe/Berlin` });
 * await prefillEventFromDescription({
 *   images: [{ base64: `…`, mediaType: `image/jpeg` }],
 *   timeZone: `Europe/Berlin`
 * });
 */
export const prefillEventFromDescription = command(prefillSchema, async ({ text, timeZone, images }) => {
	ensureUserId({ msg: `Du musst angemeldet sein, um Events importieren zu können.` });

	const trimmed = text?.trim() ?? ``;
	const imageInputs = [];
	for (const image of images ?? []) {
		const bytes = Buffer.from(image.base64, `base64`);
		if (!bytes.byteLength) continue;
		if (bytes.byteLength > MAX_IMAGE_BYTES) {
			throw new Error(`Bilder dürfen maximal 10MB groß sein`);
		}
		imageInputs.push({
			image: bytes,
			mediaType: image.mediaType
		});
	}

	if (!trimmed && !imageInputs.length) {
		return { kind: `empty` as const };
	}

	const analysis = await aiExtractEventData({
		message: trimmed,
		messageDate: new Date(),
		timezone: timeZone,
		imageInputs,
		model: `gpt-5.4-nano`,
		eventIsDefinitelyConscious: true
	});
	const fields = await mapAiAnswerToCreateEventPrefill(analysis);
	return { kind: `ok` as const, fields };
});
