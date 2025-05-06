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
		// If pagination contains lat/lng, it means the user initially searched by coords or current location.
		// We need to ensure LocationDistanceInput reflects this.
		// The current LocationDistanceInput takes an `initialLocation` string.
		// If we have lat/lng, we could format it as 'coords:lat,lng' for it,
		// or we might enhance LocationDistanceInput to take initialLat/initialLng props directly.
		// For now, we'll rely on the 'coords:' prefix if lat/lng are present in pagination.
	});

	function buildAndGoToUrl(
		pageReset: boolean,
		startDateArg?: string | null,
		endDateArg?: string | null,
		plzCityArg?: string | null, // Renamed from locationArg for clarity
		distanceArg?: string | null,
		latitudeArg?: number | null,
		longitudeArg?: number | null
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
			event.location, // This is now explicitly plzCity or null
			event.distance,
			event.latitude,
			event.longitude
		);
	}
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<DateRangePicker class="w-full md:w-fit" onChange={onDateChange} />
		<div class="flex w-full flex-col gap-2">
			<LocationDistanceInput
				initialLocation={pagination.lat && pagination.lng
					? `coords:${pagination.lat},${pagination.lng}`
					: pagination.plzCity}
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
					distance: pagination.distance,
					lat: pagination.lat,
					lng: pagination.lng
				})}
				onclick={(e) => {
					if (pagination.page <= 1) e.preventDefault();
				}}
			>
				<button class="btn" disabled={pagination.page <= 1}> Previous </button>
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
					distance: pagination.distance,
					lat: pagination.lat,
					lng: pagination.lng
				})}
				onclick={(e) => {
					if (pagination.page >= pagination.totalPages) e.preventDefault();
				}}
			>
				<button class="btn" disabled={pagination.page >= pagination.totalPages}> Next </button>
			</a>
		</div>
	{/if}
</div>
