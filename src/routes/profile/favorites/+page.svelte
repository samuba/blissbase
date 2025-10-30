<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import {
		getFavoriteEvents,
		removeFavorite
	} from '$lib/favorites.remote';
	import { page } from '$app/state';
	import EventDetailsDialog from '../../EventDetailsDialog.svelte';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';

	const favoritesQuery = getFavoriteEvents();
	let favoriteEvents = $derived(await favoritesQuery);
	const selectedEvent = $derived(favoriteEvents.find((event) => event.id === page.state.selectedEventId));

	function onRemoveFavorite(eventId: number) {
		removeFavorite(eventId).updates(
			favoritesQuery.withOverride((current) => current.filter((x) => x.id !== eventId))
		);
	}
</script>

<PageHeader backRoute="/" title="Favoriten" />

<div class=" flex items-center justify-center">
	<div class="w-full max-w-2xl">
		<div class="flex w-full flex-col gap-6 px-4">
			{#each favoriteEvents as event (event.id)}
				<div animate:flip={{ duration: 450 }} out:fade={{ duration: 250 }}>
					<EventCard {event} {onRemoveFavorite} />
				</div>
            {:else}
                <div class="text-center text-gray-500 my-4">
                    Du hast noch keine Events als Favoriten markiert.
                </div>
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
