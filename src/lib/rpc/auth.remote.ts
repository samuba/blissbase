import { command, getRequestEvent, query } from '$app/server';
import { db, s } from '$lib/server/db';
import * as v from 'valibot';

export const getUserSession = query(async () => {
	const { supabase } = getRequestEvent().locals;
	const { data, error } = await supabase.auth.getClaims();
	if (error) throw error;
	return data?.claims as BlissabaseClaims;
});

const verifyEmailOtpInputSchema = v.object({
	email: v.pipe(v.string(), v.trim(), v.email()),
	token: v.pipe(v.string(), v.trim(), v.nonEmpty()) // normalized to 6 digits in handler
});

/**
 * Verifies the email OTP on the server, persists the session via Supabase cookie handling,
 * then ensures a `profiles` row exists for the new user.
 */
export const verifyEmailOtp = command(verifyEmailOtpInputSchema, async ({ email, token }) => {
	const normalized = token.replace(/\D/g, ``).slice(0, 6);
	if (normalized.length !== 6) {
		return { ok: false as const, message: `Bitte gib den 6-stelligen Code ein.` };
	}

	const { supabase } = getRequestEvent().locals;
	const { data, error: verifyError } = await supabase.auth.verifyOtp({
		email,
		token: normalized,
		type: `email`
	});

	if (verifyError) {
		return { ok: false as const, message: mapVerifyOtpError(verifyError) };
	}
	if (!data.user) {
		return { ok: false as const, message: `Anmeldung fehlgeschlagen: Benutzer nicht gefunden.` };
	}

	await db.insert(s.profiles).values({ id: data.user.id }).onConflictDoNothing();
	return { ok: true as const };
});

function mapVerifyOtpError(err: { message?: string; code?: string }) {
	const c = err.code;
	if (c === `otp_expired`) {
		return `Der Code ist falsch oder abgelaufen.`;
	}
	if (c === `invalid_token` || c === `otp_disabled` || c === `bad_jwt`) {
		return `Der Code ist falsch oder abgelaufen.`;
	}
	return err.message ?? `Ein Fehler ist aufgetreten: ` + c;
}
