<script lang="ts">
	import DateRangePicker from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import { CalendarDateTime } from '@internationalized/date';

	const { data } = $props();
	const { events, page, limit, totalEvents, totalPages } = $derived(data);

	let startEndTime = $state({
		start: new CalendarDateTime(2024, 8, 3, 12, 30),
		end: new CalendarDateTime(2024, 8, 4, 12, 30)
	});
</script>

<div class="container mx-auto flex flex-col gap-6 p-4 sm:w-2xl">
	<DateRangePicker bind:value={startEndTime} class="w-fit" />

	{#if data.events.length > 0}
		<div class="flex w-full flex-col items-center gap-6">
			{#each data.events as event (event.id)}
				<EventCard {event} class="w-full" />
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
