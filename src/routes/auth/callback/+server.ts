import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, eq, s } from '$lib/server/db';

/**
 * Builds a same-origin redirect path with auth feedback query params for the client toast.
 * Forwards `error_code` when Supabase supplied one (OAuth callback query or API error `.code`).
 */
function redirectWithAuthFeedback(args: {
	origin: string;
	nextPath: string;
	authSuccess?: boolean;
	authError?: string;
	errorCode?: string | null;
}) {
	const { origin, nextPath, authSuccess, authError, errorCode } = args;
	const safe = safeNextPath(nextPath);
	const u = new URL(safe, origin);
	if (authSuccess) u.searchParams.set(`auth_success`, `1`);
	if (authError) u.searchParams.set(`auth_error`, authError);
	if (errorCode) u.searchParams.set(`error_code`, errorCode);
	return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Restricts open redirects to same-site paths.
 *
 * @example
 * safeNextPath(`/events`) // `/events`
 * safeNextPath(`//evil.com`) // `/`
 */
function safeNextPath(next: string | null) {
	const p = next ?? `/`;
	if (!p.startsWith(`/`) || p.startsWith(`//`)) return `/`;
	return p;
}

/**
 * GET /auth/callback
 * Handles the OAuth callback from Supabase Auth.
 * Exchanges the code for a session and redirects back to the origin page.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const origin = url.origin;
	const nextPath = safeNextPath(url.searchParams.get(`next`));

	const oauthError = url.searchParams.get(`error`);
	const oauthErrorDescription = url.searchParams.get(`error_description`);
	const oauthErrorCode = url.searchParams.get(`error_code`);
	if (oauthError) {
		const msg = oauthErrorDescription ?? oauthError;
		return redirect(
			303,
			redirectWithAuthFeedback({
				origin,
				nextPath,
				authError: msg,
				errorCode: oauthErrorCode
			})
		);
	}

	const code = url.searchParams.get(`code`);
	if (!code) {
		return redirect(
			303,
			redirectWithAuthFeedback({
				origin,
				nextPath,
				authError: `Anmeldung fehlgeschlagen: Kein gültiger Link. Bitte fordere einen neuen Login-Link an.`
			})
		);
	}

	const { error, data } = await supabase.auth.exchangeCodeForSession(code);
	if (error || !data?.user) {
		const msg =
			error?.message ??
			`Anmeldung fehlgeschlagen. Bitte versuche es erneut oder fordere einen neuen Login-Link an.`;
		return redirect(
			303,
			redirectWithAuthFeedback({
				origin,
				nextPath,
				authError: msg,
				errorCode: error?.code ?? null
			})
		);
	}

	const dbUser = await db.query.profiles.findFirst({ where: eq(s.profiles.id, data.user.id) });
	if (!dbUser) await db.insert(s.profiles).values({ id: data.user.id }).onConflictDoNothing();

	redirect(303, redirectWithAuthFeedback({ origin, nextPath, authSuccess: true }));
};

