<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { PinInput, REGEXP_ONLY_DIGITS } from 'bits-ui';
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { verifyEmailOtp } from '$lib/rpc/auth.remote';
	import { localeStore } from '../../locales/localeStore.svelte';
	import { ReactiveCountdown } from '$lib/reactiveCountdown.svelte';
	import { toast } from 'svelte-sonner';
	import { sleep } from '$lib/common';
	import { authCallbackUrl, isAuthFlowPath, routes } from '$lib/routes';

	interface Props {
		class?: string;
		onAuthenticated?: () => void;
		next?: string;
	}

	let { class: className, onAuthenticated, next }: Props = $props();

	let step = $state<`email` | `code`>(`email`);
	let email = $state(``);
	let pendingEmail = $state(``);
	let code = $state(``);
	let otpLoading = $state(false);
	let googleLoading = $state(false);
	let error = $state(``);
	let resendCooldown = new ReactiveCountdown(60);
	const isLoading = $derived(otpLoading || googleLoading);

	const nextAfterAuth = $derived(
		next ?? (isAuthFlowPath(page.url.pathname) ? routes.profile() : routes.currentPath(page.url)),
	);

	function callbackRedirectTo() {
		return authCallbackUrl({ origin: window.location.origin, next: nextAfterAuth });
	}

	async function sendOtp() {
		const supabase = getSupabaseBrowserClient();
		const trimmed = email.trim();
		if (!trimmed) return;

		otpLoading = true;
		error = ``;

		try {
			const { error: signInError } = await supabase.auth.signInWithOtp({
				email: trimmed,
				options: {
					emailRedirectTo: callbackRedirectTo(),
					data: {
						locale: localeStore.locale
					}
				}
			});

			if (signInError) throw signInError;

			await sleep(2000); // email takes some time to get

			pendingEmail = trimmed;
			email = ``;
			step = `code`;
			resendCooldown.start();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			otpLoading = false;
		}
	}

	async function resendOtp() {
		if (resendCooldown.isActive || isLoading) return;
		const supabase = getSupabaseBrowserClient();

		otpLoading = true;
		error = ``;

		try {
			const { error: signInError } = await supabase.auth.signInWithOtp({
				email: pendingEmail,
				options: {
					emailRedirectTo: callbackRedirectTo(),
					data: {
						locale: localeStore.locale
					}
				}
			});

			if (signInError) throw signInError;

			resendCooldown.start();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			otpLoading = false;
		}
	}

	async function verifyCode() {
		const token = code.replace(/\D/g, ``).slice(0, 6);
		if (token.length !== 6) {
			error = `Bitte gib den Code ein.`;
			return;
		}

		otpLoading = true;
		error = ``;

		try {
			const result = await verifyEmailOtp({ email: pendingEmail, token });
			if (!result.ok) {
				error = result.message;
				return;
			}
			await invalidateAll();
			onAuthenticated?.();
			toast.success(`Du bist jetzt angemeldet. Viel Spaß!`);
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			otpLoading = false;
		}
	}

	async function signInWithGoogle() {
		if (isLoading) return;

		googleLoading = true;
		error = ``;

		try {
			const supabase = getSupabaseBrowserClient();
			const { error: oauthError } = await supabase.auth.signInWithOAuth({
				provider: `google`,
				options: {
					redirectTo: callbackRedirectTo(),
				},
			});
			if (oauthError) throw oauthError;
		} catch (err: unknown) {
			error = mapOAuthError(err);
			console.error(`Auth error:`, err);
			googleLoading = false;
		}
	}

	function useAnotherEmail() {
		step = `email`;
		pendingEmail = ``;
		code = ``;
		error = ``;
	}

	function mapOAuthError(err: unknown) {
		if (!(err instanceof Error)) return `Ein Fehler ist aufgetreten`;
		const message = err.message.toLowerCase();
		if (message.includes(`provider is not enabled`) || message.includes(`unsupported provider`)) {
			return `Google-Anmeldung ist gerade nicht verfügbar.`;
		}
		return err.message;
	}
</script>

<div class={[className]}>
	{#if step === `email`}
		<p class="text-base-content mb-6 text-sm">
			Melde dich an um Favoriten zu speichern und eigene Events zu erstellen.
		</p>

		<button
			type="button"
			class="btn w-full"
			disabled={isLoading}
			data-testid="google-login-button"
			onclick={signInWithGoogle}
		>
			{#if googleLoading}
				<span class="loading loading-spinner"></span>
				Weiterleitung...
			{:else}
				<span class="inline-flex items-center justify-center gap-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 48 48"
						class="size-5 shrink-0"
						aria-hidden="true"
					>
						<path
							fill="#EA4335"
							d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
						/>
						<path
							fill="#4285F4"
							d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
						/>
						<path
							fill="#FBBC05"
							d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
						/>
						<path
							fill="#34A853"
							d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
						/>
					</svg>
					Mit Google anmelden
				</span>
			{/if}
		</button>

		<div class="divider">oder</div>

		<form onsubmit={(e) => { e.preventDefault(); sendOtp(); }} class="space-y-4 relative">
			<input
				type="email"
				id="email"
				autocomplete="email"
				bind:value={email}
				required
				placeholder="deine@email.de"
				class="input w-full"
				disabled={isLoading}
			/>

			{@render errorMsg()}

			<button type="submit" class="btn w-full" disabled={isLoading}>
				{#if otpLoading}
					<span class="loading loading-spinner"></span>
					Wird gesendet...
				{:else}
					<i class="icon-[ph--envelope] size-5"></i>
					Anmelde-Code senden
				{/if}
			</button>
		</form>
	{:else}
		<form onsubmit={(e) => { e.preventDefault(); verifyCode(); }} class="flex flex-col gap-4 relative">
			<div class="alert alert-success bg-success/60">
				<i class="icon-[ph--keyhole] size-7"></i>
				<span class="text-base-content">
					Wir haben dir einen Code an <b>{pendingEmail}</b> geschickt. 
					Gib den Code hier ein um dich anzumelden.
				</span>
			</div>

			<PinInput.Root
				bind:value={code}
				maxlength={6}
				disabled={isLoading}
				pattern={REGEXP_ONLY_DIGITS}
				textalign="center"
				autocomplete="one-time-code"
				inputmode="numeric"
				aria-label="Einmalcode"
				pasteTransformer={(x) => x.replace(/\D/g, ``).slice(0, 6)}
				onComplete={() => queueMicrotask(() => { void verifyCode() })}
				class="max-w-[200px] mx-auto py-6"
			>
				{#snippet children({ cells })}
					<div class="flex justify-center">
						{#each cells as cell, i (i)}
							<PinInput.Cell
								{cell}
								class="first:rounded-l-xl first:border-l-2 last:rounded-r-xl last:border-r-2 flex h-14 w-10 border-base-500  border-y-2 border-r  shrink items-center justify-center font-mono text-xl tabular-nums data-active:outline data-active:outline-primary data-active:bg-primary/15"
							>
								{#if cell.char}
									{cell.char}
								{:else if cell.hasFakeCaret}
									<span
										class="bg-base-content/80 h-5 w-px animate-caret-blink"
										aria-hidden="true"
									></span>
								{/if}
							</PinInput.Cell>
						{/each}
					</div>
				{/snippet}
			</PinInput.Root>

			{@render errorMsg()}

			<button type="submit" class="btn btn-primary w-full" disabled={isLoading}>
				{#if otpLoading}
					<span class="loading loading-spinner"></span>
					Wird geprüft...
				{:else}
					<i class="icon-[ph--key] size-5"></i>
					Anmelden
				{/if}
			</button>
		</form>

		<div class="mt-4 flex gap-2 items-center w-full justify-center flex-wrap sm:flex-row-reverse">
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				disabled={isLoading || resendCooldown.isActive}
				title={resendCooldown.isActive ? `In etwa einer Minute erneut möglich` : ``}
				onclick={resendOtp}
			>
				Code erneut senden 
				{#if resendCooldown.isActive}
					(in {resendCooldown.secondsLeft} Sekunden) 
				{/if}
			</button>
			<button type="button" class="btn btn-ghost btn-sm" disabled={isLoading} onclick={useAnotherEmail}>
				Andere E-Mail verwenden
			</button>
		</div>
	{/if}


</div>

{#snippet errorMsg()}
	{#if error}
		<div class="alert alert-error bg-error/60 mb-4">
			<i class="icon-[ph--warning] size-6"></i>
			<span>{error}</span>
		</div>
	{/if}
{/snippet}
