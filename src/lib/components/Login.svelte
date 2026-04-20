<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { PinInput, REGEXP_ONLY_DIGITS } from 'bits-ui';
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { verifyEmailOtp } from '$lib/rpc/auth.remote';
	import { localeStore } from '../../locales/localeStore.svelte';
	import { ReactiveCountdown } from '$lib/reactiveCountdown.svelte';
	import { toast } from 'svelte-sonner';
	import { sleep } from '$lib/common';

	interface Props {
		class?: string;
		onAuthenticated?: () => void;
	}

	let { class: className, onAuthenticated }: Props = $props();

	let step = $state<`email` | `code`>(`email`);
	let email = $state(``);
	let pendingEmail = $state(``);
	let code = $state(``);
	let isLoading = $state(false);
	let error = $state(``);
	let resendCooldown = new ReactiveCountdown(60);

	async function sendOtp() {
		const supabase = getSupabaseBrowserClient();
		const trimmed = email.trim();
		if (!trimmed) return;

		isLoading = true;
		error = ``;

		try {
			const emailRedirectTo = `${window.location.origin}/auth/callback`;

			const { error: signInError } = await supabase.auth.signInWithOtp({
				email: trimmed,
				options: {
					emailRedirectTo,
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
			isLoading = false;
		}
	}

	async function resendOtp() {
		if (resendCooldown.isActive || isLoading) return;
		const supabase = getSupabaseBrowserClient();

		isLoading = true;
		error = ``;

		try {
			const emailRedirectTo = `${window.location.origin}/auth/callback`;

			const { error: signInError } = await supabase.auth.signInWithOtp({
				email: pendingEmail,
				options: {
					emailRedirectTo,
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
			isLoading = false;
		}
	}

	async function verifyCode() {
		const token = code.replace(/\D/g, ``).slice(0, 6);
		if (token.length !== 6) {
			error = `Bitte gib den Code ein.`;
			return;
		}

		isLoading = true;
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
			isLoading = false;
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
		<p class="text-base-content mb-6 text-sm">
			Melde dich an um Favoriten zu speichern und eigene Events zu erstellen.
		</p>

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

			<p class="text-base-content mb-6 text-sm">
				Gib deine E-Mail-Adresse ein. Du erhältst einen Code um dich hier anzumelden.
			</p>

			{@render errorMsg()}

			<button type="submit" class="btn btn-primary w-full" disabled={isLoading}>
				{#if isLoading}
					<span class="loading loading-spinner"></span>
					Wird gesendet...
				{:else}
					<i class="icon-[ph--envelope] size-5"></i>
					Code senden
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
				{#if isLoading}
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