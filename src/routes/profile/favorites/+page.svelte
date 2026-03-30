<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import {
		getFavoritePastEvents,
		getFavoriteUpcomingEvents,
		removeFavorite
	} from '$lib/rpc/favorites.remote';
	import EventDetailsDialog from '../../EventDetailsDialog.svelte';

	let selectedTab = $state<`upcoming` | `past`>(`upcoming`);

	const upcomingEventsQuery = getFavoriteUpcomingEvents();
	const upcomingEvents = await upcomingEventsQuery;

	let pastEvents = $state<typeof upcomingEvents>([]);
	let pastEventsStatus = $state<`idle` | `loading` | `loaded`>(`idle`);

	async function fetchPastEvents() {
		if (pastEventsStatus !== `idle`) return;

		pastEventsStatus = `loading`;
		pastEvents = await getFavoritePastEvents();
		pastEventsStatus = `loaded`;
	}

	async function selectTab(tab: `upcoming` | `past`) {
		if (selectedTab === tab) return;
		selectedTab = tab;

		if (tab !== `past`) return;
		await fetchPastEvents();
	}

	function onRemoveFavorite(eventId: number) {
		removeFavorite(eventId).updates(
			upcomingEventsQuery.withOverride((current) => current.filter((x) => x.id !== eventId))
		);
		pastEvents = pastEvents.filter((x) => x.id !== eventId);
	}
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="">
		<div role="tablist" class="tabs tabs-box mt-3 bg-base-300 flex justify-center flex-row">
			<button
				role="tab"
				class="tab grow"
				class:tab-active={selectedTab === `upcoming`}
				onclick={() => selectTab(`upcoming`)}
			>
				Aktuelle Favoriten
			</button>

			<button
				role="tab"
				class="tab grow"
				class:tab-active={selectedTab === `past`}
				onclick={() => selectTab(`past`)}
				onpointerdown={fetchPastEvents}
				onmouseenter={fetchPastEvents}
				onfocus={fetchPastEvents}
			>
				Vergangene Favoriten
			</button>
		</div>

		<div class:hidden={selectedTab !== `upcoming`}>
			{#if upcomingEvents.length}
				<div class="mt-4 flex w-full flex-col gap-6">
					{#each upcomingEvents as event (event.id)}
						<EventCard {event} {onRemoveFavorite} />
					{/each}
				</div>
			{:else}
				<div class="mt-12 text-center text-base-content/60">
					Keine aktuellen Events in deinen Favoriten.
				</div>
			{/if}
		</div>

		<div class:hidden={selectedTab !== `past`}>
			{#if pastEventsStatus === `loading`}
				<div class="mt-12 flex justify-center">
					<span class="loading loading-spinner"></span>
				</div>
			{:else if pastEvents.length}
				<div class="mt-4 flex w-full flex-col gap-6">
					{#each pastEvents as event (event.id)}
						<EventCard {event} {onRemoveFavorite} />
					{/each}
				</div>
			{:else}
				<div class="mt-12 text-center text-base-content/60">
					Keine vergangenen Events in deinen Favoriten.
				</div>
			{/if}
		</div>
	</div>
</div>

<EventDetailsDialog />
