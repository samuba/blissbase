<script lang="ts">
	import DateRangePicker from './DateRangePicker.svelte';
	import LocationDistanceInput from './LocationDistanceInput.svelte';
	import Select from './Select.svelte';
	import PopOver from './PopOver.svelte';
	import InstallButton from './install-button/InstallButton.svelte';
	import { parseDate } from '@internationalized/date';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import BurgerMenu from './BurgerMenu.svelte';
	import TagSelection from './TagSelection.svelte';
	import { getTags } from './TagSelection.remote';

	let { tags }: { tags: Awaited<ReturnType<typeof getTags>> } = $props();

	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	const isSticky = $derived(scrollY > (headerElement?.offsetHeight ?? 50) - 30);
	let isDatePickerOpen = $state(false);
</script>

<svelte:window bind:scrollY />

<!-- Placeholder to reserve space when header becomes sticky -->
{#if isSticky}
	<div class="" style="height: {headerElement?.offsetHeight}px;"></div>
{/if}

<header
	bind:this={headerElement}
	class={[
		'z-10 w-full',
		isSticky ? 'bg-base-200 fixed top-0  mx-auto max-w-161 py-2.5' : 'relative'
	]}
>
	{#if isSticky}
		<!-- Collapsed Sticky Header -->
		<!-- shadow -->
		<div
			class="pointer-events-none absolute right-0 left-0 z-20 h-6"
			style="top: 100%; background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.03) 50%, transparent 100%);"
		></div>
		<div class="flex w-full items-center justify-center gap-3">
			<BurgerMenu>
				<div class="btn flex items-center justify-center text-sm font-medium">
					<img src="/logo.svg" alt="Menü" class="mr-2 size-6" />
					Menu
				</div>
			</BurgerMenu>

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
				{#if eventsStore.hasDateFilter}
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
						{#if eventsStore.hasOnlineEventsFilter}
							<i class="icon-[ph--globe] size-5"></i>
						{:else}
							<i class="icon-[ph--map-pin] size-5"></i>
						{/if}
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
								initialOnlyOnlineEvents={eventsStore.pagination.onlyOnlineEvents ?? false}
							/>
						</div>
					{/snippet}
				</PopOver>
				{#if eventsStore.hasLocationFilter || eventsStore.hasOnlineEventsFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			<!-- Tag-Filter/Search Button -->
			<div class="relative">
				<PopOver
					triggerClass="btn btn-circle"
					contentClass="card shadow-lg bg-base-200 p-2 z-20 max-w-dvw"
				>
					{#snippet trigger()}
						<i class="icon-[ph--magnifying-glass] size-5"></i>
					{/snippet}
					{#snippet content()}
						<TagSelection {tags} />
					{/snippet}
				</PopOver>
				{#if eventsStore.hasTagFilter || eventsStore.hasSearchFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			<!-- Sort Button -->
			<div class="relative" class:hidden={!eventsStore.hasLocationFilter}>
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
						triggerProps={{ class: 'btn btn-circle' }}
						hideTriggerText
						disabled={!eventsStore.hasLocationFilter}
					/>
				</div>
				{#if eventsStore.hasSortFilter}
					{@render filteredIndicator()}
				{/if}
			</div>

			{@render clearButton(false)}
		</div>
	{:else}
		<!-- Expanded Header -->
		<div class="flex flex-col gap-4 px-4">
			<div class="flex w-full flex-col items-center gap-4 md:flex-row">
				<div class="flex w-full flex-wrap items-center gap-4 md:w-auto">
					<div class="flex-shrink-0">
						<BurgerMenu>
							<div class="btn bg-base-100 flex items-center justify-center text-sm font-medium">
								<img src="/logo.svg" alt="Menü" class="mr-2 size-6 min-w-6" />
								Menu
							</div>
						</BurgerMenu>
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
						initialOnlyOnlineEvents={eventsStore.pagination.onlyOnlineEvents ?? false}
					/>
				</div>
			</div>
			<div class="flex w-full items-center gap-4">
				<TagSelection {tags} />
			</div>

			<div class="flex w-full items-center justify-center gap-4">
				{@render clearButton(true)}

				<div class:hidden={!eventsStore.hasLocationFilter}>
					<label for="sort-select" class="sr-only">Sortieren nach</label>
					<Select
						triggerProps={{ class: 'select' }}
						items={[
							{ value: 'relevance', label: 'Sortierung', disabled: true },
							{ value: 'time_asc', label: 'Startzeit', iconClass: 'icon-[ph--sort-ascending]' },
							{ value: 'distance_asc', label: 'Distanz', iconClass: 'icon-[ph--sort-ascending]' }
							// { value: 'time_desc', label: 'Startzeit', iconClass: 'icon-[ph--sort-descending]' }
							// { value: 'distance_desc', label: 'Distanz', iconClass: 'icon-[ph--sort-descending]' }
						]}
						hideTriggerText={false}
						type="single"
						value={eventsStore.selectedSortValue}
						onValueChange={eventsStore.handleSortChanged}
						disabled={!eventsStore.hasLocationFilter}
					/>
				</div>
			</div>
			<InstallButton />
		</div>
	{/if}
</header>

{#snippet clearButton(big: boolean)}
	{#if eventsStore.hasAnyFilter}
		<button
			onclick={() => eventsStore.resetFilters()}
			class="btn {big ? 'flex-grow' : 'btn-circle btn-ghost'}"
			title="Alle Filter zurücksetzen"
			aria-label="Alle Filter zurücksetzen"
		>
			<i class:hidden={big} class="icon-[ph--x] size-5"></i>
			<span class:hidden={!big} class="">Alle Filter zurücksetzen</span>
		</button>
	{/if}
{/snippet}

{#snippet filteredIndicator()}
	<div
		class="bg-primary border-base-100 absolute top-0 right-0 h-3 w-3 rounded-full border-2"
	></div>
{/snippet}
