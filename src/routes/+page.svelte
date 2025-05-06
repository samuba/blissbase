<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import LocationDistanceInput, {
		type LocationChangeEvent
	} from '$lib/components/LocationDistanceInput.svelte';
	import { goto } from '$app/navigation';
	import { routes } from '$lib/routes.js';
	import { navigating } from '$app/state';
	import SpinnerBall from 'phosphor-svelte/lib/SpinnerBall';

	const { data } = $props();
	const { events, pagination } = $derived(data); // pagination is reactive, reflects URL params

	// Effect to synchronize UI state from URL changes (via pagination prop)
	$effect(() => {
		// This effect runs whenever pagination changes
		// (e.g. when URL parameters change externally)
	});

	function buildAndGoToUrl(
		pageReset: boolean,
		startDateArg?: string | null,
		endDateArg?: string | null,
		locationArg?: string | null,
		distanceArg?: string | null
	) {
		const newParams = new URLSearchParams();

		if (pageReset) {
			newParams.set('page', '1');
		} else {
			newParams.set('page', pagination.page?.toString() ?? '1');
		}
		newParams.set('limit', pagination.limit?.toString() ?? '10');

		const finalStartDate = startDateArg !== undefined ? startDateArg : pagination.startDate;
		const finalEndDate = endDateArg !== undefined ? endDateArg : pagination.endDate;
		const finalLocation = locationArg !== undefined ? locationArg : pagination.plzCity;
		const finalDistance = distanceArg !== undefined ? distanceArg : pagination.distance;

		if (finalStartDate) newParams.set('startDate', finalStartDate);
		if (finalEndDate) newParams.set('endDate', finalEndDate);
		if (finalLocation) newParams.set('plzCity', finalLocation);
		if (finalDistance) newParams.set('distance', finalDistance);

		const currentSearchParams = new URLSearchParams(window.location.search);
		const normalize = (p: URLSearchParams) => {
			const obj: Record<string, string> = {};
			for (const [key, value] of p) {
				obj[key] = value;
			}
			return new URLSearchParams(
				Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
			).toString();
		};

		if (normalize(newParams) === normalize(currentSearchParams)) {
			return; // No effective change in URL params, skipping goto
		}

		goto(`?${newParams.toString()}`, { keepFocus: true, invalidateAll: true });
	}

	const onDateChange: DateRangePickerOnChange = (value) => {
		buildAndGoToUrl(true, value?.start?.toString() ?? null, value?.end?.toString() ?? null);
	};

	function handleLocationDistanceChange(event: LocationChangeEvent) {
		buildAndGoToUrl(
			true, // pageReset
			pagination.startDate,
			pagination.endDate,
			event.location,
			event.distance
		);
	}
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<DateRangePicker class="w-full md:w-fit" onChange={onDateChange} />
		<div class="flex w-full flex-col gap-2">
			<LocationDistanceInput
				initialLocation={pagination.plzCity}
				initialDistance={pagination.distance}
				onChange={handleLocationDistanceChange}
				disabled={!!navigating.to}
			/>
		</div>
	</div>

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
				href={routes.searchPage({
					page: pagination.page - 1,
					limit: pagination.limit,
					startDate: pagination.startDate,
					endDate: pagination.endDate,
					plzCity: pagination.plzCity,
					distance: pagination.distance
				})}
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
				href={routes.searchPage({
					page: pagination.page + 1,
					limit: pagination.limit,
					startDate: pagination.startDate,
					endDate: pagination.endDate,
					plzCity: pagination.plzCity,
					distance: pagination.distance
				})}
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
