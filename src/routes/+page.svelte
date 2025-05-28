<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import LocationDistanceInput, {
		type LocationChangeEvent
	} from '$lib/components/LocationDistanceInput.svelte';
	import { goto } from '$app/navigation';
	import { navigating, page } from '$app/state';

	import { debounce } from '$lib/common';
	import { browser } from '$app/environment';
	import Select from '$lib/components/Select.svelte';
	import type { UiEvent } from '$lib/server/events';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import InstallButton from '$lib/components/install-button/InstallButton.svelte';
	import { intersect } from '$lib/attachments/intersection';
	import { fetchEvents } from './page.telefunc';

	const { data } = $props();
	let events = $state(data.events);
	let pagination = $state(data.pagination);

	let searchTermInput = $state(pagination.searchTerm ?? '');
	let searchInputElement = $state<HTMLInputElement | null>(null);
	let isLoadingEvents = $state(false);

	async function loadEvents(params: Parameters<typeof fetchEvents>[0], append?: boolean) {
		try {
			isLoadingEvents = true;

			const data = await fetchEvents(params);
			pagination = data.pagination;
			const newEvents = data.events.map((x) => ({
				...x,
				startAt: new Date(x.startAt),
				endAt: x.endAt ? new Date(x.endAt) : null
			}));

			if (append) events.push(...newEvents);
			else events = newEvents;

			console.log(events.length);
		} finally {
			isLoadingEvents = false;
		}
	}

	async function loadMoreEvents() {
		if (isLoadingEvents) return;
		return loadEvents(
			{
				pageParam: (pagination.page ?? 1) + 1,
				limitParam: pagination.limit,
				startDateParam: pagination.startDate,
				endDateParam: pagination.endDate,
				plzCityParam: pagination.plzCity,
				distanceParam: pagination.distance,
				latParam: pagination.lat,
				lngParam: pagination.lng,
				searchTermParam: pagination.searchTerm,
				sortByParam: pagination.sortBy,
				sortOrderParam: pagination.sortOrder
			},
			true
		);
	}

	let selectedSortValue = $state(getSortValue(pagination.sortBy, pagination.sortOrder));

	function getSortValue(sortBy?: string | null, sortOrder?: string | null) {
		const sb = sortBy ?? 'time';
		const so = sortOrder ?? 'asc';
		return `${sb}_${so}`;
	}

	const onDateChange: DateRangePickerOnChange = (value) => {
		loadEvents({
			pageParam: 1,
			limitParam: pagination.limit,
			startDateParam: value?.start?.toString() ?? null,
			endDateParam: value?.end?.toString() ?? null,
			plzCityParam: pagination.plzCity,
			distanceParam: pagination.distance,
			latParam: pagination.lat,
			lngParam: pagination.lng,
			searchTermParam: pagination.searchTerm,
			sortByParam: pagination.sortBy,
			sortOrderParam: pagination.sortOrder
		});
	};

	function handleLocationDistanceChange(event: LocationChangeEvent) {
		loadEvents({
			pageParam: 1,
			limitParam: pagination.limit,
			startDateParam: pagination.startDate,
			endDateParam: pagination.endDate,
			plzCityParam: event.location,
			latParam: event.latitude ?? null,
			lngParam: event.longitude ?? null,
			distanceParam: event.distance,
			searchTermParam: pagination.searchTerm,
			sortByParam: pagination.sortBy,
			sortOrderParam: pagination.sortOrder
		});
	}

	const debouncedSearch = debounce(() => {
		loadEvents({
			pageParam: 1,
			limitParam: pagination.limit,
			startDateParam: pagination.startDate,
			endDateParam: pagination.endDate,
			plzCityParam: pagination.plzCity,
			distanceParam: pagination.distance,
			latParam: pagination.lat,
			lngParam: pagination.lng,
			searchTermParam: searchTermInput,
			sortByParam: pagination.sortBy,
			sortOrderParam: pagination.sortOrder
		});
	}, 400);

	function handleSortChanged(value: string) {
		const [sortBy, sortOrder] = value.split('_');

		loadEvents({
			pageParam: 1,
			limitParam: pagination.limit,
			startDateParam: pagination.startDate,
			endDateParam: pagination.endDate,
			plzCityParam: pagination.plzCity,
			distanceParam: pagination.distance,
			latParam: pagination.lat,
			lngParam: pagination.lng,
			searchTermParam: pagination.searchTerm,
			sortByParam: sortBy,
			sortOrderParam: sortOrder
		});
	}

	$effect(() => {
		if (!browser) return; // Guard for SSR

		const authoritativeSearchTerm = pagination.searchTerm ?? '';
		// Only update local state from URL if the input is not focused
		// and the values actually differ.
		if (
			document.activeElement !== searchInputElement &&
			searchTermInput !== authoritativeSearchTerm
		) {
			searchTermInput = authoritativeSearchTerm;
		}

		// Sync selectedSortValue with pagination data from URL
		const newSortValue = getSortValue(pagination.sortBy, pagination.sortOrder);
		if (selectedSortValue !== newSortValue) {
			selectedSortValue = newSortValue;
		}
	});
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<DateRangePicker class="w-full md:w-fit" onChange={onDateChange} />
		<LocationDistanceInput
			initialLocation={pagination.lat && pagination.lng
				? `coords:${pagination.lat},${pagination.lng}`
				: pagination.plzCity}
			initialDistance={pagination.distance}
			onChange={handleLocationDistanceChange}
		/>
	</div>
	<div class="flex w-full flex-wrap items-center justify-center gap-4">
		<label class="input w-fit">
			<i class="icon-[ph--magnifying-glass] size-5 text-gray-400"></i>
			<input
				bind:this={searchInputElement}
				bind:value={searchTermInput}
				oninput={debouncedSearch}
				type="search"
				class=""
				placeholder="Suchbegriff"
			/>
		</label>
		<div class="">
			<label for="sort-select" class="sr-only">Sortieren nach</label>
			<Select
				items={[
					{ value: 'relevance', label: 'Sortierung', disabled: true },
					{ value: 'time_asc', label: 'Startzeit', iconClass: 'icon-[ph--sort-ascending]' },
					{ value: 'distance_asc', label: 'Distanz', iconClass: 'icon-[ph--sort-ascending]' }
					// { value: 'time_desc', label: 'Startzeit', iconClass: 'icon-[ph--sort-descending]' }
					// { value: 'distance_desc', label: 'Distanz', iconClass: 'icon-[ph--sort-descending]' }
				]}
				type="single"
				value={selectedSortValue}
				onValueChange={handleSortChanged}
			/>
		</div>
		<InstallButton />
	</div>

	{#if events.length > 0}
		<div class="flex w-full flex-col items-center gap-6">
			{#each events as event, i (event.id)}
				<EventCard {event} />
			{/each}

			<div {@attach intersect({ onIntersecting: loadMoreEvents })} class="-translate-y-72"></div>

			{#if isLoadingEvents}
				<div class="flex flex-col items-center justify-center gap-3">
					<i class="icon-[ph--spinner-gap] text-primary-content size-10 animate-spin"></i>
					<p class="">Lade...</p>
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-gray-500">Keine Events gefunden.</p>
	{/if}
</div>

<EventDetailsDialog
	event={events.find((e) => e.id === page.state.selectedEventId) ??
		(undefined as unknown as UiEvent)}
/>
