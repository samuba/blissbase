import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, eq, s } from '$lib/server/db';

/**
 * GET /auth/callback
 * Handles the OAuth callback from Supabase Auth.
 * Exchanges the code for a session and redirects back to the origin page.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get(`code`);
	const next = url.searchParams.get(`next`) ?? `/`;
	if (!code) {
		const errorUrl = new URL(next, url.origin);
		errorUrl.searchParams.set('auth_error', 'Der Login-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.');
		return redirect(303, errorUrl);
	}

	const { error, data } = await supabase.auth.exchangeCodeForSession(code);
	if (error || !data?.user) {
		const errorUrl = new URL(next, url.origin);
		errorUrl.searchParams.set('auth_error', error?.message ?? 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
		return redirect(303, errorUrl);
	}

	// Create profile if it doesn't exist
	const dbUser = await db.query.profiles.findFirst({ where: eq(s.profiles.id, data.user.id) });
	if (!dbUser) await db.insert(s.profiles).values({ id: data.user.id }).onConflictDoNothing();

	// Redirect with success message
	const successUrl = new URL(next, url.origin);
	successUrl.searchParams.set('auth_success', 'true');
	redirect(303, successUrl);
};

