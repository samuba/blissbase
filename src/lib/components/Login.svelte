<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { PinInput, REGEXP_ONLY_DIGITS } from "bits-ui";
	import { getSupabaseBrowserClient } from "#lib/supabase.ts";
	import { verifyEmailOtp } from "#lib/rpc/auth.remote.ts";
	import { localeStore } from "../../locales/localeStore.svelte";
	import { ReactiveCountdown } from "#lib/reactiveCountdown.svelte.ts";
	import { toast } from "svelte-sonner";
	import { sleep } from "#lib/common.ts";
	import { authCallbackUrl, isAuthFlowPath, routes } from "#lib/routes.ts";
	import { mapOAuthError, startGoogleOAuth } from "#lib/oauthSignIn.ts";
	import GoogleSignInButton from "#lib/components/GoogleSignInButton.svelte";

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

	const nextAfterAuth = $derived(next ?? (isAuthFlowPath(page.url.pathname) ? routes.profile() : routes.currentPath(page.url)));

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
						locale: localeStore.locale,
					},
				},
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
						locale: localeStore.locale,
					},
				},
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
			await refreshAll();
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
			await startGoogleOAuth({ next: nextAfterAuth });
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
</script>

<div class={[className]}>
	{#if step === `email`}
		<p class="text-base-content mb-6 text-sm">Melde dich an um Favoriten zu speichern und eigene Events zu erstellen.</p>

		<GoogleSignInButton busy={googleLoading} disabled={isLoading} onclick={signInWithGoogle} />

		<div class="divider">oder</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				sendOtp();
			}}
			class="relative space-y-4"
		>
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
		<form
			onsubmit={(e) => {
				e.preventDefault();
				verifyCode();
			}}
			class="relative flex flex-col gap-4"
		>
			<div class="alert alert-success bg-success/60">
				<i class="icon-[ph--keyhole] size-7"></i>
				<span class="text-base-content">
					Wir haben dir einen Code an <b>{pendingEmail}</b> geschickt. Gib den Code hier ein um dich anzumelden.
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
				onComplete={() =>
					queueMicrotask(() => {
						void verifyCode();
					})}
				class="mx-auto max-w-[200px] py-6"
			>
				{#snippet children({ cells })}
					<div class="flex justify-center">
						{#each cells as cell, i (i)}
							<PinInput.Cell
								{cell}
								class="border-base-500 data-active:outline-primary data-active:bg-primary/15 flex h-14 w-10 shrink items-center  justify-center border-y-2  border-r font-mono text-xl tabular-nums first:rounded-l-xl first:border-l-2 last:rounded-r-xl last:border-r-2 data-active:outline"
							>
								{#if cell.char}
									{cell.char}
								{:else if cell.hasFakeCaret}
									<span class="bg-base-content/80 animate-caret-blink h-5 w-px" aria-hidden="true"></span>
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

		<div class="mt-4 flex w-full flex-wrap items-center justify-center gap-2 sm:flex-row-reverse">
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
			<button type="button" class="btn btn-ghost btn-sm" disabled={isLoading} onclick={useAnotherEmail}> Andere E-Mail verwenden </button>
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
