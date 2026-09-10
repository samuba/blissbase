import { getSupabaseBrowserClient } from "$lib/supabase";
import { authCallbackUrl } from "$lib/routes";

/**
 * Starts Google OAuth and leaves the page. Callers should persist any form draft first.
 */
export async function startGoogleOAuth(args: { next: string }) {
	const supabase = getSupabaseBrowserClient();
	const { error } = await supabase.auth.signInWithOAuth({
		provider: `google`,
		options: {
			redirectTo: authCallbackUrl({ origin: window.location.origin, next: args.next }),
		},
	});
	if (error) throw error;
}

export function mapOAuthError(err: unknown) {
	if (!(err instanceof Error)) return `Ein Fehler ist aufgetreten`;
	const message = err.message.toLowerCase();
	if (message.includes(`provider is not enabled`) || message.includes(`unsupported provider`)) {
		return `Google-Anmeldung ist gerade nicht verfügbar.`;
	}
	return err.message;
}
