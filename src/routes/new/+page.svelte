<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import LoginDialog from '$lib/components/LoginDialog.svelte';
	import EventForm from '$lib/components/EventForm.svelte';
	import { createEvent } from '$lib/events.remote';
	import { createEventSchema } from '$lib/events.remote.common';
	import { routes } from '$lib/routes';

	const userId = $derived(page.data.userId as string | undefined);
	let loginDialogOpen = $state(false);

	onMount(() => {
		if (userId) return;
		loginDialogOpen = true;
	});

</script>

<PageHeader backRoute={routes.root()} />

<div class="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h1 class="text-2xl font-bold">Event erstellen</h1>
				</div>
			</div>

			{#if !userId}
				<div class="alert">
					<i class="icon-[ph--user] size-5"></i>
					<span>Bitte melde dich an, um einen Event zu erstellen.</span>
				</div>
				<div class="flex flex-wrap gap-3">
					<button class="btn btn-primary" onclick={() => (loginDialogOpen = true)}>Anmelden</button>
					<a href={resolve('/new-explained')} class="btn">Andere Optionen</a>
				</div>
			{:else}
				<EventForm
					remoteForm={createEvent}
					preflightSchema={createEventSchema}
				/>

				<div class="flex flex-col-reverse sm:flex-row gap-6 justify-end">
					<button 
						type="button" 
						onclick={() => window.history.back()} 
						class="btn disabled:bg-base-300 disabled:text-base-content" 
						disabled={createEvent.pending > 0}>
						Abbrechen
					</button>

					<button 
						type="submit" 
						class="btn btn-primary disabled:bg-primary disabled:text-primary-content" 
						form="event-form" 
						disabled={createEvent.pending > 0}>
						{#if createEvent.pending === 0}
							Speichern
						{:else}
							<span class="loading loading-spinner loading-sm"></span>
							Speichere...
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<LoginDialog bind:open={loginDialogOpen} />