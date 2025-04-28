<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import { goto } from '$app/navigation';
	import { routes } from '$lib/routes.js';
	import { navigating } from '$app/state';
	import SpinnerBall from 'phosphor-svelte/lib/SpinnerBall';
	const { data } = $props();
	const { events, pagination } = $derived(data);

	const onChange: DateRangePickerOnChange = (value) => {
		if (
			!value?.start ||
			!value?.end ||
			(value.start.toString() === pagination.startDate &&
				value.end.toString() === pagination.endDate)
		) {
			return;
		}
		const params = new URLSearchParams();
		params.set('page', '1');
		params.set('limit', pagination.limit?.toString() ?? '10');
		// Use .toString() which should format as YYYY-MM-DD for CalendarDate
		params.set('startDate', value.start.toString());
		params.set('endDate', value.end.toString());
		goto(`?${params.toString()}`, { keepFocus: true, invalidateAll: true });
	};
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<DateRangePicker class="w-fit" {onChange} />

	{#if navigating.to}
		<div class="flex flex-col items-center justify-center gap-3">
			<SpinnerBall class="text-primary-content size-10 animate-spin" />
			<p class="">Lade...</p>
		</div>
	{:else if events.length > 0}
		<div class="flex w-full flex-col items-center gap-6">
			{#each events as event (event.id)}
				<EventCard {event} />
			{/each}
		</div>
	{:else}
		<p class="text-gray-500">Keine Events gefunden.</p>
	{/if}

	{#if pagination.totalPages > 1 && !navigating.to}
		<div class="mt-8 flex items-center justify-center space-x-4">
			<a
				href={routes.searchPage(
					pagination.page - 1,
					pagination.limit,
					pagination.startDate,
					pagination.endDate
				)}
				class="rounded border border-gray-300 px-4 py-2 text-sm font-medium {pagination.page <= 1
					? 'cursor-not-allowed bg-gray-100 text-gray-400'
					: 'bg-white text-gray-700 hover:bg-gray-50'}"
				aria-disabled={pagination.page <= 1}
				onclick={(e) => {
					if (pagination.page <= 1) e.preventDefault();
				}}
			>
				Previous
			</a>
			<span class="text-sm text-gray-700">
				Page {pagination.page} of {pagination.totalPages}
			</span>
			<a
				href={routes.searchPage(
					pagination.page + 1,
					pagination.limit,
					pagination.startDate,
					pagination.endDate
				)}
				class="rounded border border-gray-300 px-4 py-2 text-sm font-medium {pagination.page >=
				pagination.totalPages
					? 'cursor-not-allowed bg-gray-100 text-gray-400'
					: 'bg-white text-gray-700 hover:bg-gray-50'}"
				aria-disabled={pagination.page >= pagination.totalPages}
				onclick={(e) => {
					if (pagination.page >= pagination.totalPages) e.preventDefault();
				}}
			>
				Next
			</a>
		</div>
	{/if}
</div>
