import { command } from "$app/server";
import { error } from "@sveltejs/kit";
import { sendContactEmail } from "#lib/server/email.ts";
import * as v from "valibot";

const sendContactMessageSchema = v.object({
	email: v.pipe(v.string(), v.trim(), v.email(`Bitte gib eine gültige E-Mail-Adresse ein`)),
	message: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Bitte schreib eine Nachricht`),
		v.maxLength(10_000, `Nachricht ist zu lang (max. 5000 Zeichen)`),
	),
});

export const sendContactMessage = command(sendContactMessageSchema, async ({ email, message }) => {
	const ok = await sendContactEmail({ replyTo: email, message });
	if (!ok) error(500, `Nachricht konnte nicht gesendet werden`);
	return { ok: true as const };
});
