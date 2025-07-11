<script lang="ts">
	import DateRangePicker from './DateRangePicker.svelte';
	import LocationDistanceInput from './LocationDistanceInput.svelte';
	import Select from './Select.svelte';
	import PopOver from './PopOver.svelte';
	import InstallButton from './install-button/InstallButton.svelte';
	import { parseDate } from '@internationalized/date';
	import { routes } from '$lib/routes';
	import { debounce } from '$lib/common';
	import { eventsStore } from '$lib/eventsStore.svelte';

	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	const isSticky = $derived(scrollY > 40);

	let isDatePickerOpen = $state(false);

	// Check if inputs are in non-default state
	const hasDateFilter = $derived.by(() => {
		const today = new Date();
		const defaultStartDate = today.toISOString().split('T')[0];
		const defaultEndDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)
			.toISOString()
			.split('T')[0];
		return (
			eventsStore.pagination.startDate !== defaultStartDate ||
			eventsStore.pagination.endDate !== defaultEndDate
		);
	});
	const hasLocationFilter = $derived(
		Boolean(
			eventsStore.pagination.plzCity || (eventsStore.pagination.lat && eventsStore.pagination.lng)
		)
	);
	const hasSearchFilter = $derived(Boolean(eventsStore.pagination.searchTerm?.trim()));
	const hasSortFilter = $derived(
		eventsStore.pagination.sortBy !== 'time' || eventsStore.pagination.sortOrder !== 'asc'
	);
	const hasAnyFilter = $derived(
		hasDateFilter || hasLocationFilter || hasSearchFilter || hasSortFilter
	);

	const clearAllFilters = () => {
		eventsStore.loadEvents({
			page: 1,
			limit: 10,
			startDate: null,
			endDate: null,
			plzCity: null,
			distance: null,
			lat: null,
			lng: null,
			searchTerm: null,
			sortBy: 'time',
			sortOrder: 'asc'
		});
	};

	const debouncedSearch = debounce(() => {
		eventsStore.loadEvents({
			...eventsStore.pagination,
			page: 1
		});
	}, 400);
</script>

<svelte:window bind:scrollY />

<!-- Placeholder to reserve space when header becomes sticky -->
{#if isSticky}
	<div class="h-16"></div>
{/if}

<header
	bind:this={headerElement}
	class={[
		'z-10 w-full',
		isSticky ? 'bg-base-200 fixed top-0  mx-auto max-w-161 py-2.5' : 'relative'
	]}
>
	{#if isSticky}
		<div
			class="pointer-events-none absolute right-0 left-0 z-20 h-6"
			style="top: 100%; background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.03) 50%, transparent 100%);"
		></div>
	{/if}
	{#if isSticky}
		<!-- Collapsed Sticky Header -->
		<div class="flex w-full items-center justify-center gap-3">
			{@render logoMenu()}

			<!-- Date Button -->
			<div class="relative">
				<PopOver
					triggerClass="btn btn-circle"
					contentClass="card shadow-lg bg-base-200 z-20"
					contentProps={{
						onOpenAutoFocus: (e) => {
							e.preventDefault();
							isDatePickerOpen = true;
						}
					}}
				>
					{#snippet trigger()}
						<i class="icon-[ph--calendar-dots] size-5"></i>
					{/snippet}
					{#snippet content()}
						<div class="p-4">
							<DateRangePicker
								onChange={eventsStore.onDateChange}
								bind:open={isDatePickerOpen}
								value={{
									start: parseDate(eventsStore.pagination.startDate!),
									end: parseDate(eventsStore.pagination.endDate!)
								}}
							/>
						</div>
					{/snippet}
				</PopOver>
				{#if hasDateFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			<!-- Location Button -->
			<div class="relative">
				<PopOver
					triggerClass="btn btn-circle"
					contentClass="card shadow-lg bg-base-200 z-20"
					contentProps={{
						onOpenAutoFocus: (e) => {
							e.preventDefault(); // not giving focus cuz it would hide the "Standort" btn
						}
					}}
				>
					{#snippet trigger()}
						<i class="icon-[ph--map-pin] size-5"></i>
					{/snippet}
					{#snippet content()}
						<div class="min-w-89 p-4">
							<LocationDistanceInput
								initialLocation={eventsStore.pagination.lat && eventsStore.pagination.lng
									? `coords:${eventsStore.pagination.lat},${eventsStore.pagination.lng}`
									: eventsStore.pagination.plzCity}
								initialDistance={eventsStore.pagination.distance}
								resolvedCityName={eventsStore.pagination.lat && eventsStore.pagination.lng
									? eventsStore.pagination.plzCity
									: null}
								onChange={eventsStore.handleLocationDistanceChange}
							/>
						</div>
					{/snippet}
				</PopOver>
				{#if hasLocationFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			<!-- Search Button -->
			<div class="relative">
				<PopOver
					triggerClass="btn btn-circle"
					contentClass="card shadow-lg bg-base-200 min-w-72 p-4 z-20"
				>
					{#snippet trigger()}
						<i class="icon-[ph--magnifying-glass] size-5"></i>
					{/snippet}
					{#snippet content()}
						<label class="input w-full">
							<i class="icon-[ph--magnifying-glass] text-base-600 size-5"></i>
							<input
								value={eventsStore.pagination.searchTerm || ''}
								oninput={(e) => {
									eventsStore.updateSearchTerm(e.currentTarget.value);
									debouncedSearch();
								}}
								type="search"
								placeholder="Suchbegriff"
							/>
						</label>
					{/snippet}
				</PopOver>
				{#if hasSearchFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			<!-- Sort Button -->
			<div class="relative">
				<div class="btn btn-circle">
					<Select
						items={[
							{ value: 'relevance', label: 'Sortierung', disabled: true },
							{ value: 'time_asc', label: 'Startzeit', iconClass: 'icon-[ph--sort-ascending]' },
							{ value: 'distance_asc', label: 'Distanz', iconClass: 'icon-[ph--sort-ascending]' }
						]}
						type="single"
						value={eventsStore.selectedSortValue}
						onValueChange={eventsStore.handleSortChanged}
						contentProps={{ class: 'z-10' }}
						showAsButton
						disabled={!hasLocationFilter}
					/>
				</div>
				{#if hasSortFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			{@render clearButton()}
		</div>
	{:else}
		<!-- Expanded Header -->
		<div class="flex flex-col gap-4 px-4">
			<div class="flex w-full flex-col items-center gap-4 md:flex-row">
				<div class="flex w-full items-center justify-center gap-4">
					{@render logoMenu()}

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
					resolvedCityName={eventsStore.pagination.lat && eventsStore.pagination.lng
						? eventsStore.pagination.plzCity
						: null}
					onChange={eventsStore.handleLocationDistanceChange}
				/>
			</div>
			<div class="flex w-full items-center justify-center gap-4">
				<label class="input w-full">
					<i class="icon-[ph--magnifying-glass] text-base-600 size-5"></i>
					<input
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
						showAsButton={false}
						disabled={!hasLocationFilter}
					/>
				</div>

				{@render clearButton()}
			</div>
			<InstallButton />
		</div>
	{/if}
</header>

{#snippet logoMenu()}
	<div class="flex flex-col items-center">
		<PopOver
			triggerClass="cursor-pointer group"
			contentClass="card card-border shadow-lg bg-base-100 z-20"
			contentProps={{
				customAnchor: '.custom-popover-anchor'
			}}
		>
			{#snippet trigger()}
				<div class="drop-shadow-sm">
					<img
						src="/logo.svg"
						alt="Menu"
						class="size-10 min-w-10 transition-transform duration-500 ease-in-out group-data-[state=open]:-rotate-360"
					/>
				</div>
			{/snippet}
			{#snippet content()}
				<div class="flex max-w-lg flex-col gap-4 p-4 text-sm">
					<p class="text-lg leading-tight font-bold">Willkommen bei Blissbase</p>
					<p>
						Wir wollen die Conscious Communities Deutschlands zusammenbringen und vernetzen.
						<br />
						Dafür machen wir Events aus verschiedensten Quellen für so viele Menschen wie möglich erreichbar.
						<br />
						In einer simplen und komfortablen App.
					</p>
					<p>
						<span class="font-semibold"> Wie kann ich meinen Event eintragen? </span>
						<br />
						Trage deinen Event in eine unserer Quellen ein - er erscheint dann automatisch bei uns.
					</p>

					<a href={routes.sources()} class="btn-sm btn w-fit">Unsere Event Quellen</a>

					<div>
						<span> Fehler gefunden / Feedback geben / Kooperation / Grüße: </span>
						<div class="mt-1 flex items-center gap-1">
							<a href="mailto:hi@blissbase.app" class="link w-fit font-semibold">
								hi@blissbase.app
							</a>
						</div>
					</div>
				</div>
			{/snippet}
		</PopOver>
		<div class="custom-popover-anchor h-0 w-0">
			<!-- too prevent flickering of popover content when rotating the icon -->
		</div>
	</div>
{/snippet}

{#snippet clearButton()}
	{#if hasAnyFilter}
		<button
			onclick={clearAllFilters}
			class="btn btn-circle btn-ghost"
			title="Alle Filter zurücksetzen"
			aria-label="Alle Filter zurücksetzen"
		>
			<i class="icon-[ph--x] size-5"></i>
		</button>
	{/if}
{/snippet}

{#snippet filteredIndicator()}
	<div
		class="bg-primary border-base-100 absolute top-0 right-0 h-3 w-3 rounded-full border-2"
	></div>
{/snippet}
