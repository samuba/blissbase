import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { getRequestEvent } from '$app/server';

/**
 * Creates a Supabase server client for use in server-side code.
 * Handles cookie-based session management.
 * 
 * Uses the public/anon key for authentication operations.
 * The session is managed via cookies, which allows the server to act on behalf of the authenticated user.
 * 
 * @example
 * const supabase = createSupabaseServerClient(event.cookies);
 * const { data, error } = await supabase.auth.getClaims();
 */
export function createSupabaseServerClient() {
	const {cookies, fetch} = getRequestEvent()
	return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		global: { fetch },
		cookies: {
			getAll() {
				return cookies.getAll();
			},
			setAll(cookiesToSet) {
				cookiesToSet.forEach(({ name, value, options }) => {
					/**
					 * SvelteKit's cookies API requires `path` to be explicitly set in
					 * the cookie options. Setting `path` to `/` replicates previous/
					 * standard behavior.
					 */
					cookies.set(name, value, { ...options, path: '/' });
				});
			},
		},
	});
}

