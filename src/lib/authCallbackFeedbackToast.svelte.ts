import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import {
	EVENT_CREATE_DRAFT_KEY,
	hasPendingCreateFlowDraft,
	OFFERING_CREATE_DRAFT_KEY,
} from '$lib/createFlowDraft';
import { afterClientHydration } from '$lib/shallowDialog.svelte';
import { toast } from 'svelte-sonner';

const AUTH_FEEDBACK_TOAST_ID = `auth-callback-feedback`;

/**
 * Registers auth callback URL feedback (toasts + stripping auth feedback params and hash afterward).
 * Call once from the root layout `<script>` during component initialization — not from a side-effect-only import.
 *
 * @example
 * ```svelte
 * import { registerAuthCallbackFeedbackToast } from '$lib/authCallbackFeedbackToast.svelte';
 * registerAuthCallbackFeedbackToast();
 * ```
 */
export function registerAuthCallbackFeedbackToast() {
	let shown = false;

	$effect(() => {
		const authError = page.url.searchParams.get(`auth_error`);
		const authSuccess = page.url.searchParams.get(`auth_success`);
		if (authError === null && authSuccess === null) return;
		if (shown) return;
		shown = true;

		if (authError) {
			const errorCode = page.url.searchParams.get(`error_code`);
			const errorPros = {
				id: AUTH_FEEDBACK_TOAST_ID,
				duration: 60_000,
				closeButton: true,
				classes: { description: `whitespace-pre-line`}
			};
			if (errorCode === `otp_expired`) {
				toast.error(`Der Login-Link ist abgelaufen.`, {
					description: `Lass dir einen neuen Login-Link schicken.`,
					...errorPros
				});
			} else if (errorCode === `pkce_code_verifier_not_found`) {
				toast.error(`Login-Link stammt aus anderem Browser`, {
					description: `Fordere einen neuen Login-Link an und öffne den Link im selben Browser in dem du ihn angefordert hast.`,
					...errorPros
				});
			} else {
				toast.error(`Anmeldung fehlgeschlagen`, {
					description: authError,
					...errorPros
				});
			}
		} else if (!shouldSkipAuthSuccessToast()) {
			toast.success(`Du bist jetzt angemeldet. Viel Spaß!`, { id: AUTH_FEEDBACK_TOAST_ID });
		}

		void stripAuthFeedbackFromUrl();
	});
}

function shouldSkipAuthSuccessToast() {
	const path = page.url.pathname;
	if (path === `/events/new` || path === `/offerings/new`) return true;
	return (
		hasPendingCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY }) ||
		hasPendingCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY })
	);
}

async function stripAuthFeedbackFromUrl() {
	await afterClientHydration();
	if (
		page.url.searchParams.get(`auth_error`) === null &&
		page.url.searchParams.get(`auth_success`) === null
	) {
		return;
	}

	const nextUrl = new URL(page.url.href);
	nextUrl.searchParams.delete(`auth_success`);
	nextUrl.searchParams.delete(`auth_error`);
	nextUrl.searchParams.delete(`error_code`);
	nextUrl.hash = ``;
	replaceState(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, page.state);
}
