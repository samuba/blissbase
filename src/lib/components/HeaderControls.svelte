<script lang="ts">
	import DateRangePicker from './DateRangePicker.svelte';
	import LocationDistanceInput from './LocationDistanceInput.svelte';
	import Select from './Select.svelte';
	import PopOver from './PopOver.svelte';
	import InstallButton from './install-button/InstallButton.svelte';
	import { parseDate } from '@internationalized/date';
	import { routes } from '$lib/routes';
	import { debounce, sleep } from '$lib/common';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { onMount } from 'svelte';

	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	const isSticky = $derived(scrollY > 40);

	let isDatePickerOpen = $state(false);

	const hasDateFilter = $derived(
		eventsStore.pagination.startDate || eventsStore.pagination.endDate
	);
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

	const debouncedSearch = debounce(() => {
		eventsStore.loadEvents({
			...eventsStore.pagination,
			page: 1
		});
	}, 400);

	let logoButton = $state<HTMLDivElement | null>(null);

	onMount(async () => {
		await sleep(1200);
		logoButton?.classList.remove('rotate-360');
	});
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
			{@render logoMenu('size-10 min-w-10', 'drop-shadow-sm')}

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
									start: eventsStore.pagination.startDate
										? parseDate(eventsStore.pagination.startDate)
										: undefined,
									end: eventsStore.pagination.endDate
										? parseDate(eventsStore.pagination.endDate)
										: undefined
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
				<div class="flex w-full items-center gap-4 md:w-auto">
					<div class="-my-4 flex-shrink-0">
						{@render logoMenu('size-9.5 min-w-9.5', 'btn-lg btn btn-circle bg-base-100  ')}
					</div>

					<div class="flex-1 md:flex-none">
						<DateRangePicker
							triggerProps={{ class: 'w-full flex-grow' }}
							rootProps={{ class: 'w-full flex-grow' }}
							onChange={eventsStore.onDateChange}
							value={{
								start: eventsStore.pagination.startDate
									? parseDate(eventsStore.pagination.startDate)
									: undefined,
								end: eventsStore.pagination.endDate
									? parseDate(eventsStore.pagination.endDate)
									: undefined
							}}
						/>
					</div>
				</div>

				<div class="w-full flex-1 md:w-auto">
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

{#snippet logoMenu(logoClass: string, btnClass: string)}
	<div class="flex flex-col items-center">
		<PopOver
			triggerClass="cursor-pointer group"
			contentClass="card card-border shadow-lg bg-base-100 z-20"
			contentProps={{
				customAnchor: '.custom-popover-anchor'
			}}
		>
			{#snippet trigger()}
				<div class={btnClass}>
					<img
						src="/logo.svg"
						alt="Menu"
						bind:this={logoButton}
						class="rotate-360 transition-transform duration-500 ease-in-out group-data-[state=open]:-rotate-360 {logoClass}"
					/>
				</div>
			{/snippet}
			{#snippet content()}
				<div class="flex max-w-lg flex-col gap-4 p-4 text-sm">
					<p class="text-lg leading-tight font-bold">Willkommen bei Blissbase</p>
					<p>
						Ich will die achtsamen Communities Deutschlands zusammen bringen. Dafür sammel ich
						Events aus verschiedenen Quellen und machen sie hier zugänglich. Durchsuchbar,
						komfortabel, alles an einem Ort.
						<br />
						Ich hoffe dir gefällt meine Arbeit — LG Samuel
					</p>
					<p>
						<span class="font-semibold"> Wie kann ich meinen Event eintragen? </span>
						<br />
						Sende deinen Event einfach an meinen
						<a
							href="https://t.me/blissbase_bot"
							target="_blank"
							rel="noopener noreferrer"
							class="link font-semibold">Telegram-Bot</a
						>. Ort, Datum und Bild muss alles in einer Nachricht sein.
						<br />
						Oder trage deinen Event in eine der Quellen ein:
					</p>

					<a href={routes.sources()} class="btn-sm btn w-fit">Event Quellen</a>

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
			onclick={() => eventsStore.resetFilters()}
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
