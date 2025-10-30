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
	if (!code) return redirect(303, `/`);

	const { error, data } = await supabase.auth.exchangeCodeForSession(code);
	if (error || !data?.user) return redirect(303, `/`);

	// Create profile if it doesn't exist
	const dbUser = await db.query.profiles.findFirst({ where: eq(s.profiles.id, data.user.id) });
	if (!dbUser) await db.insert(s.profiles).values({ id: data.user.id }).onConflictDoNothing();

	redirect(303, next);
};

