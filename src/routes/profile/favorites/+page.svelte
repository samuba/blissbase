<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import { getFavoriteEvents } from '$lib/favorites.remote';
	import { page } from '$app/state';
	import EventDetailsDialog from '../../EventDetailsDialog.svelte';

	let favoriteEvents = $derived(await getFavoriteEvents());
    const selectedEvent = $derived(favoriteEvents.find(event => event.id === page.state.selectedEventId));
</script>

<PageHeader backRoute="/" title="Favoriten" />

<div class=" flex items-center justify-center"> 
	<div class="w-full max-w-2xl">
		<div class="flex w-full flex-col gap-6 px-4">
			{#each favoriteEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		</div>

		<div class="flex justify-center p-4">
			<a href="/" class="btn-sm btn">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück
			</a>
		</div>
	</div>
</div>

<EventDetailsDialog event={selectedEvent} />