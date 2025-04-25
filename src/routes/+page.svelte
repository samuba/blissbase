<script lang="ts">
	import type { ScrapedEvent } from '../types';
	import EventCard from '$lib/components/EventCard.svelte';
	const { data } = $props();
	const { events, page, limit, totalEvents, totalPages } = $derived(data);
</script>

<div class="container mx-auto p-4">
	<h1 class="mb-6 text-3xl font-bold">Upcoming Events</h1>

	{#if data.events.length > 0}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each data.events as event (event.permalink)}
				{@const cardEvent = {
					...event,
					address: event.address ?? [],
					imageUrls: event.imageUrls ?? [],
					tags: event.tags ?? []
				}}
				<EventCard event={cardEvent} />
			{/each}
		</div>
	{:else}
		<p class="text-gray-500">No events found.</p>
	{/if}

	{#if totalPages > 1}
		<div class="mt-8 flex items-center justify-center space-x-4">
			<a
				href="?page={page - 1}&limit={limit}"
				class="rounded border border-gray-300 px-4 py-2 text-sm font-medium {page <= 1
					? 'cursor-not-allowed bg-gray-100 text-gray-400'
					: 'bg-white text-gray-700 hover:bg-gray-50'}"
				aria-disabled={page <= 1}
				onclick={(e) => {
					if (page <= 1) e.preventDefault();
				}}
			>
				Previous
			</a>
			<span class="text-sm text-gray-700">
				Page {page} of {totalPages}
			</span>
			<a
				href="?page={page + 1}&limit={limit}"
				class="rounded border border-gray-300 px-4 py-2 text-sm font-medium {page >= totalPages
					? 'cursor-not-allowed bg-gray-100 text-gray-400'
					: 'bg-white text-gray-700 hover:bg-gray-50'}"
				aria-disabled={page >= totalPages}
				onclick={(e) => {
					if (page >= totalPages) e.preventDefault();
				}}
			>
				Next
			</a>
		</div>
	{/if}
</div>
