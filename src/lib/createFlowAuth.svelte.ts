import { invalidateAll } from "$app/navigation";
import { tick } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { localeStore } from "../locales/localeStore.svelte";
import { verifyEmailOtp } from "$lib/rpc/auth.remote";
import { checkEmailProfileComplete } from "$lib/rpc/profile.remote";
import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
import { getSupabaseBrowserClient } from "$lib/supabase";
import { authCallbackUrl, routes } from "$lib/routes";
import { mapOAuthError, startGoogleOAuth } from "$lib/oauthSignIn";

const EMAIL_CHECK_DEBOUNCE_MS = 500;

export class CreateFlowAuth {
	email = $state(``);
	checkedEmail = $state(``);
	emailProfileIsPublic = $state<boolean | null>(null);
	emailProfileHasSocialLink = $state<boolean | null>(null);
	emailLoadedProfile = $state<EmailLoadedProfile | null>(null);
	emailCheckBusy = $state(false);
	emailCheckError = $state(``);
	otpCode = $state(``);
	pendingEmail = $state(``);
	authBusy = $state(false);
	authError = $state(``);
	authVerified = $state(false);
	submitAuthToken = $state(``);
	clientReady = $state(false);
	isSignedIn = $state(false);
	requireSocialLink = $state(true);
	emailProfileComplete = $derived.by(() => {
		if (this.isSignedIn) return true;
		if (this.emailProfileIsPublic === null) return null;
		if (!this.requireSocialLink) return Boolean(this.emailLoadedProfile?.displayName?.trim());
		if (!this.emailProfileIsPublic) return false;
		return this.emailProfileHasSocialLink === true;
	});

	#emailProfileCheckPromises = new SvelteMap<string, Promise<EmailProfileCheckResult>>();
	#emailProfileCheckDebounce: ReturnType<typeof setTimeout> | null = null;
	#onSubmitAuthTokenChange?: (token: string) => void;

	constructor(args: { isSignedIn: boolean; requireSocialLink?: boolean; onSubmitAuthTokenChange?: (token: string) => void }) {
		this.isSignedIn = args.isSignedIn;
		this.requireSocialLink = args.requireSocialLink ?? true;
		this.authVerified = args.isSignedIn;
		this.#onSubmitAuthTokenChange = args.onSubmitAuthTokenChange;
	}

	resetEmailProfileCheck(emailValue = this.email) {
		const trimmed = emailValue.trim();
		this.clearEmailProfileCheckDebounce();
		if (this.checkedEmail !== trimmed) {
			this.#clearEmailProfileFlags();
			this.checkedEmail = ``;
		}
		this.emailCheckError = ``;
		this.authVerified = false;
		this.#setSubmitAuthToken(``);
		if (!trimmed) return;
		this.#emailProfileCheckDebounce = setTimeout(() => {
			this.#emailProfileCheckDebounce = null;
			void this.checkEmailProfileStatus({ showError: false });
		}, EMAIL_CHECK_DEBOUNCE_MS);
	}

	onEmailInput(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		this.email = input.value;
		this.resetEmailProfileCheck(input.value);
	}

	clearEmailProfileCheckDebounce() {
		if (!this.#emailProfileCheckDebounce) return;
		clearTimeout(this.#emailProfileCheckDebounce);
		this.#emailProfileCheckDebounce = null;
	}

	async checkEmailProfileStatus(args: { showError: boolean }) {
		const trimmed = this.email.trim();
		if (this.isSignedIn) return true;
		if (!trimmed) {
			if (args.showError) this.emailCheckError = `Bitte gib deine E-Mail-Adresse ein.`;
			this.#clearEmailProfileFlags();
			return false;
		}
		if (this.checkedEmail === trimmed && this.emailProfileIsPublic !== null) return true;

		if (args.showError) this.emailCheckError = ``;
		const result = await this.#getEmailProfileCheck(trimmed);
		if (this.email.trim() !== trimmed) return false;
		if (result.ok) {
			this.emailCheckError = ``;
			this.checkedEmail = trimmed;
			this.emailProfileIsPublic = result.isPublic;
			this.emailProfileHasSocialLink = result.hasSocialLink;
			this.emailLoadedProfile = result.profile;
			return true;
		}

		this.#clearEmailProfileFlags();
		if (args.showError) this.emailCheckError = result.message;
		return false;
	}

	async onEmailBlur() {
		this.clearEmailProfileCheckDebounce();
		await this.checkEmailProfileStatus({ showError: false });
	}

	async sendOtpCode(args: { emailAddress?: string; resetCode?: boolean } = {}) {
		const trimmed = (args.emailAddress ?? this.email).trim();
		if (this.authBusy) return false;
		if (!trimmed) {
			this.authError = `Bitte gib deine E-Mail-Adresse ein.`;
			return false;
		}

		this.authBusy = true;
		this.authError = ``;
		try {
			const supabase = getSupabaseBrowserClient();
			const emailRedirectTo = authCallbackUrl({
				origin: window.location.origin,
				next: routes.currentPath(new URL(window.location.href)),
			});
			const { error } = await supabase.auth.signInWithOtp({
				email: trimmed,
				options: {
					emailRedirectTo,
					data: {
						locale: localeStore.locale,
					},
				},
			});
			if (error) throw error;
			this.pendingEmail = trimmed;
			if (args.resetCode !== false) this.otpCode = ``;
			return true;
		} catch (err: unknown) {
			this.authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
			return false;
		} finally {
			this.authBusy = false;
		}
	}

	async verifyCode() {
		if (this.authBusy) return false;
		const token = this.otpCode.replace(/\D/g, ``).slice(0, 6);
		if (token.length !== 6) {
			this.authError = `Bitte gib den 6-stelligen Code ein.`;
			return false;
		}

		this.authBusy = true;
		this.authError = ``;
		try {
			const result = await verifyEmailOtp({ email: this.pendingEmail, token });
			if (!result.ok) {
				this.authError = result.message;
				return false;
			}
			this.#setSubmitAuthToken(result.submitAuthToken);
			await invalidateAll();
			if (!this.submitAuthToken) {
				this.authError = `Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.`;
				return false;
			}

			this.authVerified = true;
			return true;
		} catch (err: unknown) {
			this.authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
			return false;
		} finally {
			this.authBusy = false;
		}
	}

	useAnotherEmail() {
		this.pendingEmail = ``;
		this.otpCode = ``;
		this.authError = ``;
		this.resetEmailProfileCheck();
	}

	async resendCode() {
		await this.sendOtpCode({ emailAddress: this.pendingEmail || this.email });
	}

	async signInWithGoogle(args: { next: string }) {
		if (this.authBusy) return false;

		this.authBusy = true;
		this.authError = ``;
		try {
			await startGoogleOAuth({ next: args.next });
			return true;
		} catch (err: unknown) {
			this.authError = mapOAuthError(err);
			console.error(`Auth error:`, err);
			this.authBusy = false;
			return false;
		}
	}

	async initializeClient() {
		this.clientReady = true;
		try {
			await getSupabaseBrowserClient().auth.getSession();
		} catch (err) {
			console.error(`Auth client init failed:`, err);
		}
	}

	destroy() {
		this.clearEmailProfileCheckDebounce();
	}

	#setSubmitAuthToken(token: string) {
		this.submitAuthToken = token;
		this.#onSubmitAuthTokenChange?.(token);
	}

	#clearEmailProfileFlags() {
		this.emailProfileIsPublic = null;
		this.emailProfileHasSocialLink = null;
		this.emailLoadedProfile = null;
	}

	#getEmailProfileCheck(trimmed: string) {
		const existingPromise = this.#emailProfileCheckPromises.get(trimmed);
		if (existingPromise) return existingPromise;

		// Keep texts out of nested callbacks: wuchale does not declare its runtime inside them in .svelte.ts files
		const fallbackErrorMessage = `E-Mail konnte nicht geprüft werden.`;
		const promise = checkEmailProfileComplete({ email: trimmed })
			.then(
				(result) =>
					({
						ok: true,
						isPublic: result.isPublic,
						hasSocialLink: result.hasSocialLink,
						profile: {
							displayName: result.displayName,
							bio: result.bio,
							profileImageUrl: result.profileImageUrl,
							bannerImageUrl: result.bannerImageUrl,
							socialLinks: result.socialLinks,
						},
					}) satisfies EmailProfileCheckResult,
			)
			.catch(
				(err: unknown) =>
					({
						ok: false,
						message: err instanceof Error ? err.message : fallbackErrorMessage,
					}) satisfies EmailProfileCheckResult,
			)
			.finally(() => {
				if (this.#emailProfileCheckPromises.get(trimmed) !== promise) return;
				this.#emailProfileCheckPromises.delete(trimmed);
			});
		this.#emailProfileCheckPromises.set(trimmed, promise);
		return promise;
	}
}

export async function submitCreateFlowForm(args: {
	formId: string;
	beforeSubmit?: (form: HTMLFormElement) => boolean;
}) {
	const deadline = Date.now() + (args.beforeSubmit ? 4000 : 2000);
	while (Date.now() < deadline) {
		const form = document.getElementById(args.formId);
		if (form instanceof HTMLFormElement && (args.beforeSubmit?.(form) ?? true)) {
			const previousNoValidate = form.noValidate;
			form.noValidate = true;
			form.requestSubmit();
			form.noValidate = previousNoValidate;
			return true;
		}
		await tick();
	}
	return false;
}

export function assignCreateFlowImageClaims(args: { tokens: string[]; form: HTMLFormElement; testId: string }) {
	const existing = [...args.form.querySelectorAll(`[data-testid="${args.testId}"]`)].filter(
		(el): el is HTMLInputElement => el instanceof HTMLInputElement,
	);
	const name = existing[0]?.name || `imageClaims`;
	const wanted = new Set(args.tokens);
	for (const input of existing) {
		if (wanted.has(input.value)) continue;
		input.remove();
	}
	const remaining = [...args.form.querySelectorAll(`[data-testid="${args.testId}"]`)].filter(
		(el): el is HTMLInputElement => el instanceof HTMLInputElement,
	);
	for (const token of args.tokens) {
		const match = remaining.find((el) => el.value === token);
		if (match) {
			match.checked = true;
			continue;
		}
		const input = document.createElement(`input`);
		input.type = `hidden`;
		input.name = name;
		input.value = token;
		input.checked = true;
		input.setAttribute(`data-testid`, args.testId);
		args.form.append(input);
	}
	const present = [...args.form.querySelectorAll(`[data-testid="${args.testId}"]`)].filter(
		(el): el is HTMLInputElement => el instanceof HTMLInputElement,
	);
	return args.tokens.every((token) => present.some((el) => el.value === token && (el.type === `hidden` || el.checked)));
}

export async function waitForCreateFlowSubmit(args: {
	isPending: () => boolean;
	startTimeoutMs?: number;
}): Promise<`started` | `idle`> {
	const startDeadline = Date.now() + (args.startTimeoutMs ?? 4000);
	while (!args.isPending() && Date.now() < startDeadline) {
		await tick();
	}
	if (!args.isPending()) return `idle`;
	while (args.isPending()) {
		await tick();
	}
	return `started`;
}

export function fieldHasIssues(field: FormFieldWithIssues) {
	return Boolean(field.issues?.()?.length || field.allIssues?.()?.length);
}

type FormFieldWithIssues = {
	issues?: () => unknown[] | undefined;
	allIssues?: () => unknown[] | undefined;
};

type EmailLoadedProfile = {
	displayName: string;
	bio: string;
	profileImageUrl: string;
	bannerImageUrl: string;
	socialLinks: PublicProfileSocialLinks;
};

type EmailProfileCheckResult =
	| {
			ok: true;
			isPublic: boolean;
			hasSocialLink: boolean;
			profile: EmailLoadedProfile;
	  }
	| {
			ok: false;
			message: string;
	  };
