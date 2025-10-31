<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { createSupabaseBrowserClient } from '$lib/supabase';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let email = $state(``);
	let isLoading = $state(false);
	let error = $state(``);
	let successMessage = $state(``);

	async function handleEmailAuth() {
		const supabase = createSupabaseBrowserClient();

		isLoading = true;
		error = ``;
		successMessage = ``;

		try {
			const { error: signInError } = await supabase.auth.signInWithOtp({
				email,
				options: {
					emailRedirectTo: `${window.location.origin}/auth/callback`
				}
			});

			if (signInError) throw signInError;

			successMessage = `Login-Link wurde an <b>${email}</b> gesendet. Bitte überprüfe dein Postfach.`;

			// Clear email after successful submission
			email = ``;
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			error = errorMessage;
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

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-sm duration-700"
		/>
		<Dialog.Content
			class={[
				'bg-base-100 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl',
			]}
		>
			<Dialog.Title class="mb-4 text-xl font-semibold">Anmelden</Dialog.Title>

			{#if !successMessage}
				<Dialog.Description class="text-base-content mb-6 text-sm">
					Gib deine E-Mail-Adresse ein, dann erhältst du einen Login-Link zum Anmelden.
				</Dialog.Description>
			{/if}

			{#if error}
				<div class="alert alert-error bg-error/60 mb-4">
					<i class="icon-[ph--warning] size-6"></i>
					<span>{error}</span>
				</div>
			{/if}

			{#if successMessage}
				<div class="alert alert-success bg-success/60 mb-4">
					<i class="icon-[ph--check-circle] size-7"></i>
					<span class="text-base-content">{@html successMessage}</span>
				</div>
			{/if}

			{#if !successMessage}
				<form onsubmit={handleSubmit} class="space-y-4">
					<input
						type="email"
						id="email"
						autocomplete="email"
						bind:value={email}
						required
						placeholder="deine@email.de"
						class="input w-full"
						disabled={isLoading || !!successMessage}
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

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
