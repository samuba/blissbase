<script lang="ts">
	import DateRangePicker from '$lib/components/DateRangePicker.svelte';
	import EventCard from '$lib/components/EventCard.svelte';
	import LocationDistanceInput from '$lib/components/LocationDistanceInput.svelte';
	import { page } from '$app/state';
	import Select from '$lib/components/Select.svelte';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import InstallButton from '$lib/components/install-button/InstallButton.svelte';
	import { intersect } from '$lib/attachments/intersection';
	import { parseDate } from '@internationalized/date';
	import PopOver from '$lib/components/PopOver.svelte';
	import { routes } from '$lib/routes';
	import { debounce } from '$lib/common';
	import { eventsStore } from '$lib/eventsStore.svelte';

	const { data } = $props();

	if (eventsStore.events.length === 0) {
		// do not initialize from server when already populated (navigated from an event page)
		eventsStore.initialize({
			events: data.events,
			pagination: data.pagination
		});
	}

	let searchInputElement = $state<HTMLInputElement | null>(null);

	// Debounced search function
	const debouncedSearch = debounce(() => {
		eventsStore.loadEvents({
			...eventsStore.pagination,
			page: 1
		});
	}, 400);

	$inspect(eventsStore.pagination);
</script>

<div class="container mx-auto flex flex-col items-center justify-center gap-6 p-4 sm:w-2xl">
	<div class="flex w-full flex-col items-center gap-6 md:flex-row md:justify-center">
		<div class="flex items-center gap-6">
			<div class="flex flex-col items-center">
				<PopOver
					triggerClass="cursor-pointer transition-transform duration-500 data-[state=open]:-rotate-360"
					contentClass="card card-border shadow-lg bg-base-100 z-10"
					contentProps={{
						customAnchor: '.custom-popover-anchor'
					}}
				>
					{#snippet trigger()}
						<img src="/logo.svg" alt="Menu" class="size-10 min-w-10" />
					{/snippet}
					{#snippet content()}
						<div class="flex max-w-lg flex-col gap-4 p-4 text-sm">
							<p class="text-lg leading-tight font-bold">Willkommen bei Blissbase</p>
							<p>
								Wir wollen die Conscious Communities Deutschlands zusammenbringen und vernetzen.
								<br />
								Dafür machen wir Events aus verschiedensten Quellen für so viele Menschen wie möglich
								erreichbar.
								<br />
								In einer simplen und komfortablen App.
							</p>
							<p>
								<span class="font-semibold"> Wie kann ich meinen Event eintragen? </span>
								<br />
								Trage deinen Event einfach in eine unserer Quellen ein, dann wird er nach ein paar Stunden
								automatisch zu uns übertragen.
							</p>

							<a href={routes.sources()} class="underline">Unsere Event Quellen</a>

							<p>
								<a href="mailto:hi@blissbase.app" class="underline"> Schreib uns gerne </a> 🙂
							</p>
						</div>
					{/snippet}
				</PopOver>
				<div class="custom-popover-anchor h-0 w-0">
					<!-- too prevent flickering of popover content when rotating the icon -->
				</div>
			</div>

			<DateRangePicker
				class="w-full md:w-fit"
				onChange={eventsStore.onDateChange}
				value={{
					start: parseDate(eventsStore.pagination.startDate!),
					end: parseDate(eventsStore.pagination.endDate!)
				}}
			/>
		</div>

		<LocationDistanceInput
			initialLocation={eventsStore.pagination.lat && eventsStore.pagination.lng
				? `coords:${eventsStore.pagination.lat},${eventsStore.pagination.lng}`
				: eventsStore.pagination.plzCity}
			initialDistance={eventsStore.pagination.distance}
			onChange={eventsStore.handleLocationDistanceChange}
		/>
	</div>
	<div class="flex w-full items-center justify-center gap-4">
		<label class="input w-full">
			<i class="icon-[ph--magnifying-glass] text-base-600 size-5"></i>
			<input
				bind:this={searchInputElement}
				value={eventsStore.pagination.searchTerm || ''}
				oninput={(e) => {
					eventsStore.updateSearchTerm(e.currentTarget.value);
					debouncedSearch();
				}}
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
				value={eventsStore.selectedSortValue}
				onValueChange={eventsStore.handleSortChanged}
			/>
		</div>
	</div>
	<InstallButton />

	{#if eventsStore.isLoading}
		{@render loading()}
	{:else if eventsStore.hasEvents}
		<div class="fade-in flex w-full flex-col items-center gap-6">
			{#each eventsStore.events as event, i (event.id)}
				<EventCard {event} />
			{/each}

			<div
				{@attach intersect({ onIntersecting: eventsStore.loadMoreEvents })}
				class="-translate-y-72"
			></div>

			{#if eventsStore.isLoadingMore}
				{@render loading()}
			{/if}
		</div>
	{:else}
		<p class="text-gray-500">Keine Events gefunden.</p>
	{/if}
</div>

{#snippet loading()}
	<div class="mb-3 flex flex-col items-center justify-center gap-2">
		<img src="/logo.svg" alt="Blissbase" class="size-10 min-w-10 animate-spin" />
		<p class="">Lade...</p>
	</div>
{/snippet}

<EventDetailsDialog event={eventsStore.getEventById(page.state.selectedEventId ?? null)} />
