import { browser } from '$app/environment';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { toast } from 'svelte-sonner';

/**
 * Registers auth callback URL feedback (toasts + stripping query string and hash afterward).
 * Call once from the root layout `<script>` during component initialization — not from a side-effect-only import.
 *
 * @example
 * ```svelte
 * import { registerAuthCallbackFeedbackToast } from '$lib/authCallbackFeedbackToast.svelte';
 * registerAuthCallbackFeedbackToast();
 * ```
 */
export function registerAuthCallbackFeedbackToast() {
	let strippingUrl = false;

	$effect(() => {
		if (!browser) return;

		const authError = page.url.searchParams.get(`auth_error`);
		const authSuccess = page.url.searchParams.get(`auth_success`);

		if (authError === null && authSuccess === null) {
			strippingUrl = false;
			return;
		}

		if (strippingUrl) return;
		strippingUrl = true;

		if (authError) {
			const errorPros = {
				duration: 30_000,
				closeButton: true,
				classes: { description: `whitespace-pre-line`}
			};
			if (page.url.searchParams.get(`error_code`) === `otp_expired`) {
				toast.error(`Der Login-Link ist abgelaufen.`, {
					description: `Lass dir einen neuen Login-Link schicken.`,
					...errorPros
				});
			} else {
				toast.error(`Anmeldung fehlgeschlagen`, {
					description: authError,
					...errorPros
				});
			}
		} else {
			toast.success(`Du bist jetzt angemeldet. Viel Spaß!`);
		}

		queueMicrotask(() => {
			try {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off clone to drop query + hash from current URL
				const nextUrl = new URL(page.url.href);
				nextUrl.search = ``;
				nextUrl.hash = ``;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- same-origin path derived from page.url (already app-routed)
				replaceState(`${nextUrl.pathname}${nextUrl.search}`, page.state);
			} finally {
				strippingUrl = false;
			}
		});
	});
}
