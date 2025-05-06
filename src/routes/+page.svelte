<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import { goto } from '$app/navigation';
	import { routes } from '$lib/routes.js';
	import { navigating } from '$app/state';
	import SpinnerBall from 'phosphor-svelte/lib/SpinnerBall';
	import Crosshair from 'phosphor-svelte/lib/crosshair';
	const { data } = $props();
	const { events, pagination } = $derived(data);

	let plzCity = $state(pagination.plzCity || '');
	let distance = $state(pagination.distance || '');

	const distanceOptions = [
		{ value: '5', label: '< 5 km' },
		{ value: '10', label: '< 10 km' },
		{ value: '15', label: '< 15 km' },
		{ value: '30', label: '< 30 km' },
		{ value: '50', label: '< 50 km' },
		{ value: '100', label: '< 100 km' },
		{ value: '150', label: '< 150 km' },
		{ value: '300', label: '< 300 km' },
		{ value: '400', label: '< 400 km' }
	];

	const onDateChange: DateRangePickerOnChange = (value) => {
		applyFilters(value?.start?.toString(), value?.end?.toString());
	};

	function applyFilters(
		startDate?: string | undefined,
		endDate?: string | undefined,
		location?: string | undefined,
		dist?: string | undefined
	) {
		const params = new URLSearchParams();
		params.set('page', '1');
		params.set('limit', pagination.limit?.toString() ?? '10');

		const currentStartDate = startDate !== undefined ? startDate : pagination.startDate;
		const currentEndDate = endDate !== undefined ? endDate : pagination.endDate;
		const currentLocation = location !== undefined ? location : plzCity;
		const currentDistance = dist !== undefined ? dist : distance;

		if (currentStartDate) params.set('startDate', currentStartDate);
		if (currentEndDate) params.set('endDate', currentEndDate);
		if (currentLocation) params.set('plzCity', currentLocation);
		if (currentDistance) params.set('distance', currentDistance);

		// Avoid navigation if parameters haven't actually changed from current pagination state
		// (excluding page and limit which are reset here)
		let hasChanged = false;
		if (params.get('startDate') !== pagination.startDate) hasChanged = true;
		if (params.get('endDate') !== pagination.endDate) hasChanged = true;
		if (params.get('plzCity') !== pagination.plzCity) hasChanged = true;
		if (params.get('distance') !== pagination.distance) hasChanged = true;

		// If only page/limit changed, or nothing changed, and all filter values are the same as current, don't navigate
		// This is a simplified check. A more robust check would compare all individual params.
		const currentParams = new URLSearchParams(window.location.search);
		currentParams.set('page', '1'); // Normalize page for comparison
		currentParams.set('limit', pagination.limit?.toString() ?? '10'); // Normalize limit

		let allFiltersAreSame = true;
		if (params.get('startDate') !== currentParams.get('startDate')) allFiltersAreSame = false;
		if (params.get('endDate') !== currentParams.get('endDate')) allFiltersAreSame = false;
		if (params.get('plzCity') !== currentParams.get('plzCity')) allFiltersAreSame = false;
		if (params.get('distance') !== currentParams.get('distance')) allFiltersAreSame = false;

		if (!hasChanged && allFiltersAreSame && params.toString() === currentParams.toString()) {
			// if no meaningful filter changed that would trigger a reload
			if (
				currentStartDate === pagination.startDate &&
				currentEndDate === pagination.endDate &&
				currentLocation === pagination.plzCity &&
				currentDistance === pagination.distance
			) {
				return;
			}
		}

		goto(`?${params.toString()}`, { keepFocus: true, invalidateAll: true });
	}

	function handleLocationFilterApply() {
		applyFilters(
			pagination.startDate ?? undefined,
			pagination.endDate ?? undefined,
			plzCity,
			distance
		);
	}

	// Initialize plzCity and distance from URL on component mount if available
	$effect(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const urlPlzCity = urlParams.get('plzCity');
		const urlDistance = urlParams.get('distance');
		if (urlPlzCity && urlPlzCity !== plzCity) {
			plzCity = urlPlzCity;
		}
		if (urlDistance && urlDistance !== distance) {
			distance = urlDistance;
		}
	});
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<DateRangePicker class="w-full md:w-fit" onChange={onDateChange} />
		<div class="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-end">
			<div class="form-control join w-full md:w-auto">
				<input
					type="text"
					id="plzCity"
					placeholder="PLZ oder Stadt"
					class="input input-bordered join-item w-full border-r-0"
					bind:value={plzCity}
					onchange={handleLocationFilterApply}
				/>
				<button
					class="btn btn-ghost join-item border-base-500 border-x-0 p-2.5"
					title="Aktuellen Standort verwenden"
					onclick={handleLocationFilterApply}
				>
					<Crosshair class=" size-5" />
				</button>
				<select
					id="distance"
					class="select select-bordered join-item w-auto"
					bind:value={distance}
					onchange={handleLocationFilterApply}
				>
					<option value="">Überall</option>
					{#each distanceOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
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
