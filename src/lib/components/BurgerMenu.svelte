<script lang="ts">
	import { routes } from '$lib/routes';
	import { Dialog } from 'bits-ui';
	import LoginDialog from './LoginDialog.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import ShareButton from './ShareButton.svelte';
	import { isPwa } from '$lib/isPwa.svelte';
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from '$lib/common';
	import { estimateEventCount } from '$lib/events.remote';

	interface Props {
		children?: any;
		userId?: string | null;
		class?: string;
	}

	const { children, userId, class: className }: Props = $props();

	let open = $state(false);
	let loginDialogOpen = $state(false);
	let isLoggingOut = $state(false);

	const eventCount = $derived(Math.floor((await estimateEventCount()) / 1000) * 1000);
	

	async function handleLogout() {
		isLoggingOut = true;
		try {
			const supabase = createSupabaseBrowserClient();
			await supabase.auth.signOut();
			open = false;
		} catch (error) {
			console.error(`Logout error:`, error);
		} finally {
			isLoggingOut = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={[className, 'cursor-pointer']}>
		{@render children()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class={["fixed inset-0 z-50 bg-black/80", dialogOverlayAnimationClasses]} />
		<Dialog.Content
			class={[
				"card bg-base-100 fixed top-[50%] left-[50%] z-50 w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] outline-hidden sm:max-w-lg sm:p-4 md:w-full", 
				dialogContentAnimationClasses
			]}
			tabindex={-1}
		>
			<div class="flex max-w-lg flex-col gap-4 p-4 text-sm">
				<h1 class="text-lg leading-tight font-bold">
					<img src="logo.svg" alt="Blissbase" class="mr-1 inline-block size-9 min-w-9" />
					Willkommen bei Blissbase
				</h1>
				<p class="-mt-2">
					Ich will die achtsamen Communities Deutschlands zusammen bringen. Dafür sammel ich Events (über <b>{eventCount}</b>)
					aus verschiedenen Quellen und machen sie hier zugänglich. Durchsuchbar, komfortabel, alles
					an einem Ort.
					<br />
					Ich hoffe dir gefällt meine Arbeit.
				</p>
				<div class="-mt-2 flex items-center gap-3">
					<img src="/me.jpg" alt="Samuel" class="size-12 min-w-12 rounded-full" />
					<div class="flex flex-col">
						<span>Peace, Love & Light 🌻</span>
						<i class="text-sm">Samuel</i>
					</div>
				</div>

				<p>
					PS. Das Projekt ist noch in den Kinderschuhen und ich weiß noch nicht wohin es sich
					entwickelt. Deshalb bin ich sehr dankbar für jedes Feedback, Ideen und Kooperation: <a
						href="mailto:hi@blissbase.app"
						class="link w-fit font-semibold"
					>
						hi@blissbase.app
					</a>
				</p>

				<div class="flex flex-wrap gap-4">
					<a href={routes.newEvent()} class="btn btn-primary w-fit">
						<i class="icon-[ph--plus] size-5"></i>
						Neuen Event erstellen
					</a>

					{#if userId}
						<a href={routes.favorites()} class="btn w-fit">
							<i class="icon-[ph--heart] size-5"></i>
							Favoriten
						</a>

						<button class="btn w-fit" onclick={handleLogout} disabled={isLoggingOut}>
							{#if isLoggingOut}
								<span class="loading loading-spinner"></span>
								Wird abgemeldet...
							{:else}
								<i class="icon-[ph--sign-out] size-5"></i>
								Abmelden
							{/if}
						</button>
					{:else}
						<button class="btn w-fit" onclick={() => (loginDialogOpen = true)}>
							<i class="icon-[ph--user] size-5"></i>
							Login
						</button>
					{/if}

					{#if isPwa.value}
						<ShareButton url="https://blissbase.app" btnTextMobile="App teilen" btnTextNonMobile="App link teilen" />
					{/if}
				</div>
			</div>

			<Dialog.Close class="btn btn-circle absolute  top-3 right-3 shadow-lg sm:top-4 sm:right-4">
				<i class="icon-[ph--x] size-5"></i>
				<span class="sr-only">Schließen</span>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<LoginDialog bind:open={loginDialogOpen} />
