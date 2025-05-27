<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import LocationDistanceInput, {
		type LocationChangeEvent
	} from '$lib/components/LocationDistanceInput.svelte';
	import { goto } from '$app/navigation';
	import { routes } from '$lib/routes';
	import { navigating, page } from '$app/state';

	import { debounce } from '$lib/common';
	import { browser } from '$app/environment';
	import Select from '$lib/components/Select.svelte';
	import type { UiEvent } from './+page.server';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import InstallButton from '$lib/components/install-button/InstallButton.svelte';

	const { data } = $props();
	const { events, pagination } = $derived(data); // pagination is reactive, reflects URL params

	let searchTermInput = $state(pagination.searchTerm ?? '');
	let searchInputElement = $state<HTMLInputElement | null>(null);

	const sortOptions = $state([
		{ value: 'time_asc', label: 'Startzeit', iconClass: 'icon-[ph--sort-ascending]' },
		// { value: 'time_desc', label: 'Time (Latest First)' },
		{ value: 'distance_asc', label: 'Distanz', iconClass: 'icon-[ph--sort-ascending]' }
		// { value: 'distance_desc', label: 'Distance (Farthest First)' }
	]);

	let selectedSortValue = $state(getSortValue(pagination.sortBy, pagination.sortOrder));

	function getSortValue(sortBy?: string | null, sortOrder?: string | null) {
		const sb = sortBy ?? 'time';
		const so = sortOrder ?? 'asc';
		return `${sb}_${so}`;
	}

	function buildAndGoToUrl(
		pageReset: boolean,
		startDateArg?: string | null,
		endDateArg?: string | null,
		plzCityArg?: string | null, // Renamed from locationArg for clarity
		distanceArg?: string | null,
		latitudeArg?: number | null,
		longitudeArg?: number | null,
		searchTermArg?: string | null,
		sortByArg?: string | null,
		sortOrderArg?: string | null
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
		const finalPlzCity = plzCityArg !== undefined ? plzCityArg : pagination.plzCity;
		const finalDistance = distanceArg !== undefined ? distanceArg : pagination.distance;
		const finalLatitude = latitudeArg !== undefined ? latitudeArg : pagination.lat;
		const finalLongitude = longitudeArg !== undefined ? longitudeArg : pagination.lng;
		const finalSearchTerm = searchTermArg !== undefined ? searchTermArg : pagination.searchTerm;
		const finalSortBy = sortByArg !== undefined ? sortByArg : pagination.sortBy;
		const finalSortOrder = sortOrderArg !== undefined ? sortOrderArg : pagination.sortOrder;

		if (finalStartDate) newParams.set('startDate', finalStartDate);
		if (finalEndDate) newParams.set('endDate', finalEndDate);

		// Only set plzCity if lat/lng are not primary
		if (finalLatitude !== null && finalLongitude !== null) {
			newParams.set('lat', finalLatitude.toString());
			newParams.set('lng', finalLongitude.toString());
			// If lat/lng are present, plzCity is not used for primary search
			// but can be kept if it was part of the original pagination data and not overridden.
			if (finalPlzCity && plzCityArg === undefined) {
				// Keep original plzCity if not explicitly cleared by new plzCityArg
				newParams.set('plzCity', finalPlzCity);
			}
		} else if (finalPlzCity) {
			newParams.set('plzCity', finalPlzCity);
		}

		if (finalDistance) newParams.set('distance', finalDistance);
		if (finalSearchTerm && finalSearchTerm.trim() !== '')
			newParams.set('searchTerm', finalSearchTerm);
		if (finalSortBy) newParams.set('sortBy', finalSortBy);
		if (finalSortOrder) newParams.set('sortOrder', finalSortOrder);

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
		buildAndGoToUrl(
			true,
			value?.start?.toString() ?? null,
			value?.end?.toString() ?? null,
			pagination.plzCity,
			pagination.distance,
			pagination.lat,
			pagination.lng,
			searchTermInput,
			pagination.sortBy,
			pagination.sortOrder
		);
	};

	function handleLocationDistanceChange(event: LocationChangeEvent) {
		buildAndGoToUrl(
			true, // pageReset
			pagination.startDate,
			pagination.endDate,
			event.location,
			event.distance,
			event.latitude,
			event.longitude,
			searchTermInput,
			pagination.sortBy,
			pagination.sortOrder
		);
	}

	const debouncedSearch = debounce(() => {
		if (navigating.to) return; // Prevent search if already navigating
		buildAndGoToUrl(
			true, // pageReset
			pagination.startDate,
			pagination.endDate,
			pagination.plzCity,
			pagination.distance,
			pagination.lat,
			pagination.lng,
			searchTermInput,
			pagination.sortBy,
			pagination.sortOrder
		);
	}, 400);

	function handleSortChanged(value: string) {
		const [sortBy, sortOrder] = value.split('_');

		buildAndGoToUrl(
			true, // pageReset
			pagination.startDate,
			pagination.endDate,
			pagination.plzCity,
			pagination.distance,
			pagination.lat,
			pagination.lng,
			searchTermInput,
			sortBy,
			sortOrder
		);
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

ph--map-pin

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<InstallButton />
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
	<div class="flex w-full items-center justify-center gap-4">
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
				items={sortOptions}
				type="single"
				value={selectedSortValue}
				onValueChange={handleSortChanged}
			/>
		</div>
	</div>

	{#if navigating.to}
		<div class="flex flex-col items-center justify-center gap-3">
			<i class="icon-[ph--spinner-gap] text-primary-content size-10 animate-spin"></i>
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
		<div class=" flex items-center justify-center space-x-4">
			<a
				href={routes.searchPage({
					page: pagination.page - 1,
					limit: pagination.limit,
					startDate: pagination.startDate,
					endDate: pagination.endDate,
					plzCity: pagination.plzCity,
					distance: pagination.distance,
					lat: pagination.lat,
					lng: pagination.lng,
					searchTerm: pagination.searchTerm,
					sortBy: pagination.sortBy,
					sortOrder: pagination.sortOrder
				})}
				onclick={(e) => {
					if (pagination.page <= 1) e.preventDefault();
				}}
				aria-label="Vorherige Seite"
			>
				<button class="btn" disabled={pagination.page <= 1} aria-label="Vorherige Seite">
					<i class="icon-[ph--caret-left] size-5"></i>
				</button>
			</a>
			<span class="text-sm text-gray-700">
				{pagination.page} von {pagination.totalPages}
			</span>
			<a
				href={routes.searchPage({
					page: pagination.page + 1,
					limit: pagination.limit,
					startDate: pagination.startDate,
					endDate: pagination.endDate,
					plzCity: pagination.plzCity,
					distance: pagination.distance,
					lat: pagination.lat,
					lng: pagination.lng,
					searchTerm: pagination.searchTerm,
					sortBy: pagination.sortBy,
					sortOrder: pagination.sortOrder
				})}
				onclick={(e) => {
					if (pagination.page >= pagination.totalPages) e.preventDefault();
				}}
				aria-label="Nächste Seite"
			>
				<button
					class="btn"
					disabled={pagination.page >= pagination.totalPages}
					aria-label="Nächste Seite"
				>
					<i class="icon-[ph--caret-right] size-5"></i>
				</button>
			</a>
		</div>
	{/if}
</div>

<EventDetailsDialog
	event={events.find((e) => e.id === page.state.selectedEventId) ??
		(undefined as unknown as UiEvent)}
/>
