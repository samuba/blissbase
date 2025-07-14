<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import { page } from '$app/state';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import { intersect } from '$lib/attachments/intersection';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import HeaderControls from '$lib/components/HeaderControls.svelte';
	import { browser } from '$app/environment';

	const { data } = $props();

	// Always initialize from server data during SSR to prevent state pollution
	// On client, only initialize if store is empty (preserves navigation state)
	if (!browser || eventsStore.events.length === 0) {
		console.log('Initializing events store from server data');
		eventsStore.initialize({
			events: data.events,
			pagination: data.pagination
		});
	}

	$inspect(eventsStore.pagination);
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 py-4 sm:w-2xl">
	<HeaderControls />

	<div class="px-4">
		{#if eventsStore.isLoading}
			{@render loading()}
		{:else if eventsStore.hasEvents}
			<div class="fade-in flex w-full flex-col items-center gap-6">
				{#each eventsStore.events as event, i (event.id)}
					<EventCard {event} />
				{/each}

				<div
					{@attach intersect({ onIntersecting: eventsStore.loadMoreEvents })}
					class="-translate-y-72"
				/>

				{#if eventsStore.isLoadingMore}
					{@render loading()}
				{/if}
			</div>
		{:else}
			<p class="text-gray-500">Keine Events gefunden.</p>
		{/if}
	</div>
</div>

{#snippet loading()}
	<div class="mb-3 flex flex-col items-center justify-center gap-2">
		<img src="/logo.svg" alt="Blissbase" class="size-10 min-w-10 animate-spin" />
		<p class="">Lade...</p>
	</div>
{/snippet}

<EventDetailsDialog event={eventsStore.getEventById(page.state.selectedEventId ?? null)} />
