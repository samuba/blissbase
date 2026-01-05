<script lang="ts">
	import DateRangePicker from './DateRangePicker.svelte';
	import LocationDistanceInput from './LocationDistanceInput.svelte';
	import { parseDate } from '@internationalized/date';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import BurgerMenu from './BurgerMenu.svelte';
	import TagSelection from './TagSelection.svelte';
	import { Dialog } from 'bits-ui';
	import ToggleButton from './ToggleButton.svelte';
	import { fade, fly } from 'svelte/transition';
	interface Props {
		userId: string | undefined;
	}

	let { userId }: Props = $props();

	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	let contentBeforeMenuHeight = $state(0);
	const showShadow = $derived(scrollY > ((headerElement?.offsetHeight ?? 50) + contentBeforeMenuHeight - 100));
	let isFilterDialogOpen = $state(false);
	const sortByTime = $derived(eventsStore.selectedSortValue === 'time_asc');
	const sortByDistance = $derived(eventsStore.selectedSortValue === 'distance_asc');

	const startDate = $derived(eventsStore.pagination.startDate ? parseDate(eventsStore.pagination.startDate) : undefined);
	const endDate = $derived(eventsStore.pagination.endDate ? parseDate(eventsStore.pagination.endDate) : undefined);

	const resolvedCityName = $derived(eventsStore.pagination.lat && eventsStore.pagination.lng
		? eventsStore.pagination.plzCity
		: null);
	const initialLocation = $derived(eventsStore.pagination.lat && eventsStore.pagination.lng
		? `coords:${eventsStore.pagination.lat},${eventsStore.pagination.lng}`
		: eventsStore.pagination.plzCity);

	$effect(() => {
		contentBeforeMenuHeight = document.getElementById('content-before-menu')?.clientHeight ?? 0;
		const unsubscribe = eventsStore.onFinishedLoading((append) => {
			if (!append) {
				window.scrollTo({ top: scrollY - (headerElement?.clientHeight ?? 0), behavior: 'instant' });
			}
		})
		return () => {
			unsubscribe();
		}
	})
</script>

<svelte:window bind:scrollY />

<header
	bind:this={headerElement}
	class={[ 'z-10 w-full flex flex-col gap-3 bg-base-200 sticky top-0  max-w-161 py-3 mt-3' ]}
	id="header-controls"
>		
	<!-- shadow -->
	{#if showShadow}
		<div
			class="pointer-events-none absolute right-0 left-0 z-20 h-6"
			style="top: 100%; background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.03) 50%, transparent 100%);"
		></div>
	{/if}
	<div class="flex w-full items-center justify-center gap-3 px-4 sm:px-0">
		<BurgerMenu {userId} class="hidden md:block">
			<div class="py-2 flex items-center justify-center text-sm font-medium">
				<i class="icon-[ph--list] size-5"></i>
			</div>
		</BurgerMenu>
		<div class="w-full min-w-0 flex-1 md:w-auto">
			<LocationDistanceInput
				initialLocation={initialLocation}
				initialDistance={eventsStore.pagination.distance}
				resolvedCityName={resolvedCityName}
				onChange={eventsStore.handleLocationDistanceChange}
			/>
		</div>

		<button class={['btn relative', eventsStore.hasFilterBehindButton && 'active']} onclick={() => isFilterDialogOpen = true}>		
			<i class="icon-[ph--sliders] size-5"></i>
			Filter
		</button>
	</div>


	<div class="flex w-full items-center gap-4 px-4 sm:px-0">
		<BurgerMenu {userId} class="block md:hidden">
			<div class="py-2 flex items-center justify-center text-sm font-medium">
				<i class="icon-[ph--list] size-5"></i>
				<!-- <img src="/logo.svg" alt="Menü" class="mr-2 size-6" />
				Menu -->
			</div>
		</BurgerMenu>

		<TagSelection />
	</div>
</header>

<!-- filter dialog -->
<Dialog.Root bind:open={isFilterDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay forceMount>
			{#snippet child({ props, open })}
				{#if open}
					<div {...props} class="fixed inset-0 z-50 bg-stone-800/90" transition:fade={{ duration: 200 }}></div>
				{/if}
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content forceMount>
			{#snippet child({ props, open })}
				{#if open}
					<div 
						{...props} 
						class={[
							'bg-base-200 fixed top-1/2 left-1/2 z-50 h-full md:h-auto max-h-dvh w-full max-w-dvw -translate-x-1/2 -translate-y-1/2',
							'md:rounded-lg shadow-xl sm:max-w-md flex flex-col',
							'overflow-y-auto' 
						]}
						transition:fly={{ y: 50, duration: 250 }}
					>
			<Dialog.Title class="text-xl font-semibold w-full text-center mt-4">
				Filter
			</Dialog.Title>

			<div class="flex flex-col gap-5 p-6">
				<div class="flex flex-col items-start gap-3">
					<h3>Zeitraum</h3>
					<DateRangePicker
						onChange={eventsStore.onDateChange}
						value={{ start: startDate, end: endDate }}
						showLongText
					/>
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Entfernung</h3>
					<div class="w-full min-w-0">
						<LocationDistanceInput
							initialLocation={initialLocation}
							initialDistance={eventsStore.pagination.distance}
							resolvedCityName={resolvedCityName}
							onChange={eventsStore.handleLocationDistanceChange}
						/>
					</div>
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Teilnahme</h3>
					<div class="flex flex-row items-center gap-3">
						<ToggleButton 
							checked={eventsStore.pagination.attendanceMode === 'offline' || eventsStore.pagination.attendanceMode === 'offline+online'}
							onchange={() => {
								if (eventsStore.pagination.attendanceMode === 'online') {
									eventsStore.handleAttendanceModeChange('offline+online');
								} else if (eventsStore.pagination.attendanceMode === 'offline+online') {
									eventsStore.handleAttendanceModeChange('online');
								} else if (eventsStore.pagination.attendanceMode === 'offline') {
									eventsStore.handleAttendanceModeChange(null);
								} else if (!eventsStore.pagination.attendanceMode) {
									eventsStore.handleAttendanceModeChange('offline');
								}
							}}
						>
							Vorort
						</ToggleButton>

						<ToggleButton checked={eventsStore.pagination.attendanceMode === 'online' || eventsStore.pagination.attendanceMode === 'offline+online'} 				
							onchange={() => {
								if (eventsStore.pagination.attendanceMode === 'offline') {
									eventsStore.handleAttendanceModeChange('offline+online');
								} else if (eventsStore.pagination.attendanceMode === 'offline+online') {
									eventsStore.handleAttendanceModeChange('offline');
								} else if (eventsStore.pagination.attendanceMode === 'online') {
									eventsStore.handleAttendanceModeChange(null);
								} else if (!eventsStore.pagination.attendanceMode) {
									eventsStore.handleAttendanceModeChange('online');
								}
							}}
						>
							Online
						</ToggleButton>
					</div>
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Sortierung</h3>
					<div class="flex flex-row items-center gap-3">
						<ToggleButton 
							checked={sortByTime} 
							onchange={() => eventsStore.handleSortChanged('time_asc')}
						>
							Startzeit
						</ToggleButton>
						<ToggleButton 
							checked={sortByDistance} 
							tooltip={eventsStore.pagination.attendanceMode === 'online' ? 'Sortieren nach Distanz macht nur für Vorort-Events Sinn' : eventsStore.pagination.lat && eventsStore.pagination.lng ? '' : 'Setze zuerst einen Standort'}
							onchange={() => {
								if (eventsStore.pagination.lat && eventsStore.pagination.lng) {
									eventsStore.handleSortChanged('distance_asc');
								}
							}}
						>
							Distanz
						</ToggleButton>
					</div>
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Zurücksetzen</h3>
					<button class="btn" onclick={() => eventsStore.resetFilters()}>
						<i class="icon-[ph--arrow-u-up-left] size-5"></i>
						Alle Filter zurücksetzen
					</button>
				</div>
			</div>

			<!-- <div class="grow"></div> -->
			<div class="flex w-full items-center justify-end px-6 pb-6 pt-3">
				<Dialog.Close class="btn btn-primary w-full md:w-auto">Ergebnisse anzeigen</Dialog.Close>
			</div>
			<Dialog.Close
				class="hover:bg-base-100 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
					</div>
				{/if}
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

{#snippet filteredIndicator()}
	<div
		class="bg-primary border-base-100 absolute top-0 right-0 h-3 w-3 rounded-full border-2"
	></div>
{/snippet}
