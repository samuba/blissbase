<script lang="ts">
	import DateRangePicker, {
		type DateRangePickerOnChange
	} from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import LocationDistanceInput, {
		type LocationChangeEvent
	} from '$lib/components/LocationDistanceInput.svelte';
	import { page } from '$app/state';
	import { debounce } from '$lib/common';
	import Select from '$lib/components/Select.svelte';
	import type { UiEvent } from '$lib/server/events';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import InstallButton from '$lib/components/install-button/InstallButton.svelte';
	import { intersect } from '$lib/attachments/intersection';
	import { fetchEvents } from './page.telefunc';
	import { parseDate } from '@internationalized/date';
	import PopOver from '$lib/components/PopOver.svelte';

	const { data } = $props();
	let events = $state(data.events);
	let pagination = $state(data.pagination);

	let searchInputElement = $state<HTMLInputElement | null>(null);
	let isLoadingEvents = $state(false);

	$inspect(pagination);

	async function loadEvents(params: Parameters<typeof fetchEvents>[0], append?: boolean) {
		try {
			isLoadingEvents = true;

			const data = await fetchEvents(params);

			if (append) {
				// sometimes pagination can result in duplicate events => Filter out events that already exist
				const existingEventIds = new Set(events.map((event) => event.id));
				events.push(...data.events.filter((event) => !existingEventIds.has(event.id)));
			} else {
				events = data.events;
			}
			pagination = data.pagination;
		} finally {
			isLoadingEvents = false;
		}
	}

	async function loadMoreEvents() {
		if (isLoadingEvents) return;
		return loadEvents(
			{
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
			...pagination,
			page: 1,
			limit: pagination.limit,
			startDate: value?.start?.toString() ?? null,
			endDate: value?.end?.toString() ?? null
		});
	};

	function handleLocationDistanceChange(event: LocationChangeEvent) {
		loadEvents({
			...pagination,
			page: 1,
			plzCity: event.location,
			lat: event.latitude ?? null,
			lng: event.longitude ?? null,
			distance: event.distance
		});
	}

	const debouncedSearch = debounce(() => {
		loadEvents({
			...pagination,
			page: 1
		});
	}, 400);

	function handleSortChanged(value: string) {
		const [sortBy, sortOrder] = value.split('_');
		loadEvents({
			...pagination,
			page: 1,
			sortBy: sortBy,
			sortOrder: sortOrder
		});
	}
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<div class="flex items-center gap-6">
			<PopOver contentClass="card card-border shadow-lg bg-base-100 z-10">
				{#snippet trigger()}
					<button class="btn btn-circle btn-ghost">
						<img src="/favicon.png" alt="Logo" class="size-9" />
					</button>
				{/snippet}
				{#snippet content()}
					<div class="p-4 text-sm">
						<p>Willkommen bei Blissbase</p>
						<p>
							Blissbase ist eine Plattform für Events, die dir helfen, die besten Events in deiner
							Nähe zu finden.
						</p>
						<p></p>

						<a href="">Woher kommen die Events?</a>
						<a href="">Events eintragen</a>
					</div>
				{/snippet}
			</PopOver>

			<DateRangePicker
				class="w-full md:w-fit"
				onChange={onDateChange}
				value={{
					start: parseDate(pagination.startDate),
					end: parseDate(pagination.endDate)
				}}
			/>
		</div>

		<LocationDistanceInput
			initialLocation={pagination.lat && pagination.lng
				? `coords:${pagination.lat},${pagination.lng}`
				: pagination.plzCity}
			initialDistance={pagination.distance}
			onChange={handleLocationDistanceChange}
		/>
	</div>
	<div class="flex w-full items-center justify-center gap-4">
		<label class="input w-full">
			<i class="icon-[ph--magnifying-glass] text-base-600 size-5"></i>
			<input
				bind:this={searchInputElement}
				bind:value={pagination.searchTerm}
				oninput={debouncedSearch}
				type="search"
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
	</div>
	<InstallButton />

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
