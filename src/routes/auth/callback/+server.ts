import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, s, sql } from '$lib/server/db';
import { resolveSupportedLocale } from '$lib/common';
import { AUTH_NEXT_QUERY, routePathname, routes, safeAuthNextPath } from '$lib/routes';

/**
 * Builds a same-origin redirect path with auth feedback query params for the client toast.
 * Forwards `error_code` when Supabase supplied one (OAuth callback query or API error `.code`).
 */
function redirectWithAuthFeedback(args: {
	origin: string;
	nextPath: string;
	fallback: string;
	authSuccess?: boolean;
	authError?: string;
	errorCode?: string | null;
}) {
	const { origin, nextPath, fallback, authSuccess, authError, errorCode } = args;
	const safe = safeAuthNextPath({ next: nextPath, fallback, origin });
	const u = new URL(safe, origin);
	if (authSuccess) u.searchParams.set(`auth_success`, `1`);
	if (authError) u.searchParams.set(`auth_error`, authError);
	if (errorCode) u.searchParams.set(`error_code`, errorCode);
	return `${u.pathname}${u.search}${u.hash}`;
}

function googleDisplayName(userMetadata: Record<string, unknown> | undefined) {
	const candidates = [userMetadata?.full_name, userMetadata?.name, userMetadata?.display_name];
	for (const candidate of candidates) {
		if (typeof candidate !== `string`) continue;
		const trimmed = candidate.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

/**
 * GET /auth/callback
 * Handles the OAuth / magic-link callback from Supabase Auth.
 * Exchanges the code for a session and redirects back to the origin page.
 */
export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
	const origin = url.origin;
	const fallback = routePathname(routes.profile(), origin);
	const nextPath = safeAuthNextPath({
		next: url.searchParams.get(AUTH_NEXT_QUERY),
		fallback,
		origin,
	});

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
				fallback,
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
				fallback,
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
				fallback,
				authError: msg,
				errorCode: error?.code ?? null
			})
		);
	}

	const locale = resolveSupportedLocale(
		(typeof data.user.user_metadata?.locale === `string` ? data.user.user_metadata.locale : null) ??
			cookies.get(`locale`),
	);
	const displayName = googleDisplayName(data.user.user_metadata);

	await db.insert(s.profiles).values({
		id: data.user.id,
		locale,
		...(displayName ? { displayName } : {}),
	}).onConflictDoUpdate({
		target: s.profiles.id,
		set: {
			locale,
			...(displayName
				? { displayName: sql`coalesce(${s.profiles.displayName}, ${displayName})` }
				: {}),
		},
	});

	redirect(303, redirectWithAuthFeedback({ origin, nextPath, fallback, authSuccess: true }));
};
