<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import { getFavoriteEvents, removeFavorite } from '$lib/favorites.remote';
	import { page } from '$app/state';
	import EventDetailsDialog from '../../EventDetailsDialog.svelte';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { addHours } from '$lib/common';
	import { now } from '$lib/now.svelte';

	const favoritesQuery = getFavoriteEvents();
	const favoriteEvents = await favoritesQuery
	const selectedEvent = $derived(
		favoriteEvents.find((event) => event.id === page.state.selectedEventId)
	);
	const pastEvents = $derived(
		favoriteEvents.filter((event) => (event.endAt ?? addHours(event.startAt, 4)) < now.value)
	);
	const upcomingEvents = $derived(
		favoriteEvents.filter((x) => !pastEvents.some((y) => y.id === x.id))
	);

	function onRemoveFavorite(eventId: number) {
		removeFavorite(eventId).updates(
			favoritesQuery.withOverride((current) => current.filter((x) => x.id !== eventId))
		);
	}
</script>

<div class="flex items-center justify-center">
	<div class="w-full max-w-2xl px-4 py-4 md:py-0">
		{#if upcomingEvents.length}
			<div class="flex w-full flex-col gap-6">
				{#each upcomingEvents as event (event.id)}
					<div animate:flip={{ duration: 450 }} out:fade={{ duration: 250 }}>
						<EventCard {event} {onRemoveFavorite} />
					</div>		
				{/each}
			</div>
		{/if}

		{#if pastEvents.length}
			<div class="flex w-full flex-col gap-6" class:mt-6={upcomingEvents.length}>
				{#each pastEvents as event (event.id)}
					<div animate:flip={{ duration: 450 }} out:fade={{ duration: 250 }}>
						<EventCard {event} {onRemoveFavorite} />
					</div>
				{/each}
			</div>
		{/if}

		{#if upcomingEvents.length === 0 && pastEvents.length === 0}
			<div class="text-center text-gray-500 my-4">Keine Events in deinen Favoriten.</div>
		{/if}
	</div>
</div>

<EventDetailsDialog event={selectedEvent} />
