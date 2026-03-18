<script lang="ts">
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { localeStore } from '../../locales/localeStore.svelte';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();

	let email = $state(``);
	let isLoading = $state(false);
	let error = $state(``);
	let successEmail = $state<string | null>(null);

	async function handleEmailAuth() {
		const supabase = getSupabaseBrowserClient();

		isLoading = true;
		error = ``;
		successEmail = null;

		try {
			const emailRedirectTo = `${window.location.origin}/auth/callback`;

			const { error: signInError } = await supabase.auth.signInWithOtp({
				email,
				options: {
					emailRedirectTo,
					data: {
						locale: localeStore.locale
					}
				}
			});

			if (signInError) throw signInError;

			successEmail = email;
			email = ``;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			isLoading = false;
		}
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		handleEmailAuth();
	}
</script>

<div class={[className]}>
	{#if !successEmail}
		<p class="text-base-content mb-6 text-sm">
			Gib deine E-Mail-Adresse ein, dann erhältst du einen Login-Link zum Anmelden.
		</p>
	{/if}

	{#if error}
		<div class="alert alert-error bg-error/60 mb-4">
			<i class="icon-[ph--warning] size-6"></i>
			<span>{error}</span>
		</div>
	{/if}

	{#if successEmail}
		<div class="alert alert-success bg-success/60 mb-4">
			<i class="icon-[ph--check-circle] size-7"></i>
			<span class="text-base-content">
				Login-Link wurde an <b>{successEmail}</b> gesendet. Bitte überprüfe dein Postfach.
			</span>
		</div>
	{/if}

	{#if !successEmail}
		<form onsubmit={handleSubmit} class="space-y-4">
			<input
				type="email"
				id="email"
				autocomplete="email"
				bind:value={email}
				required
				placeholder="deine@email.de"
				class="input w-full"
				disabled={isLoading || !!successEmail}
			/>

			<button type="submit" class="btn btn-primary w-full" disabled={isLoading}>
				{#if isLoading}
					<span class="loading loading-spinner"></span>
					Wird gesendet...
				{:else}
					<i class="icon-[ph--envelope] size-5"></i>
					Login-Link senden
				{/if}
			</button>
		</form>
	{/if}
</div>

