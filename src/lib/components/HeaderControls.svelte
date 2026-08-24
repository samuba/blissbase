<script lang="ts">
	import DateRangePicker from "./DateRangePicker.svelte";
	import LocationDistanceInput from "./LocationDistanceInput.svelte";
	import type { LocationChangeEvent } from "./LocationDistanceInput.svelte";
	import { parseDate } from "@internationalized/date";
	import { eventsStore } from "$lib/eventsStore.svelte";
	import CategorySelection from "./CategorySelection.svelte";
	import { Dialog } from "$lib/components/dialog";
	import ToggleButton from "./ToggleButton.svelte";
	import TabsNavDesktop from "./TabsNavDesktop.svelte";
	import { routes } from "$lib/routes";
	import { user } from "$lib/user.svelte";
	import AdminEventSourceFilter from "./AdminEventSourceFilter.svelte";

	let {
		onLocationDistanceChange = eventsStore.handleLocationDistanceChange,
		eventSources = null,
		eventSourceFilter = null,
	}: {
		onLocationDistanceChange?: (event: LocationChangeEvent) => void;
		eventSources?: string[] | null;
		eventSourceFilter?: string | null;
	} = $props();

	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	let contentBeforeMenuHeight = $state(0);
	const showShadow = $derived(scrollY > (headerElement?.offsetHeight ?? 50) + contentBeforeMenuHeight - 100);
	let isFilterDialogOpen = $state(false);
	const sortByTime = $derived(eventsStore.selectedSortValue === "time_asc");
	const sortByDistance = $derived(eventsStore.selectedSortValue === "distance_asc");
	let showOfferingsLink = $state(true);

	const startDate = $derived(eventsStore.pagination.startDate ? parseDate(eventsStore.pagination.startDate) : undefined);
	const endDate = $derived(eventsStore.pagination.endDate ? parseDate(eventsStore.pagination.endDate) : undefined);

	const resolvedCityName = $derived(
		eventsStore.pagination.lat != null && eventsStore.pagination.lng != null ? eventsStore.pagination.plzCity : null,
	);
	const initialLocation = $derived(
		eventsStore.pagination.plzCity ||
			(eventsStore.pagination.lat != null && eventsStore.pagination.lng != null
				? `coords:${eventsStore.pagination.lat},${eventsStore.pagination.lng}`
				: null),
	);

	$effect(() => {
		contentBeforeMenuHeight = document.getElementById("content-before-menu")?.clientHeight ?? 0;
		const unsubscribe = eventsStore.onFinishedLoading((append) => {
			if (!append) {
				window.scrollTo({ top: scrollY - (headerElement?.clientHeight ?? 0), behavior: "instant" });
			}
		});
		return () => {
			unsubscribe();
		};
	});

	function openFilterDialog() {
		// Defer so Playwright's opening click is not treated as an outside interact
		// once the overlay mounts on top of the filter button.
		setTimeout(() => {
			isFilterDialogOpen = true;
		}, 0);
	}

	function handleFilterInteractOutside(event: Event) {
		const target = event.target;
		if (target instanceof Element && target.closest(`[data-testid="open-filter-dialog"]`)) {
			event.preventDefault();
		}
	}
</script>

<svelte:window bind:scrollY />

<header
	bind:this={headerElement}
	class={[`bg-base-200 sticky top-0 z-10 w-full pt-4`, showOfferingsLink ? `mb-3 pb-0 sm:mb-0` : ` pb-1`]}
	id="header-controls"
>
	<!-- shadow -->
	{#if showShadow}
		<div
			class="pointer-events-none absolute right-0 left-0 z-20 h-6"
			style="top: 100%; background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.03) 50%, transparent 100%);"
		></div>
	{/if}

	<div class="mx-auto flex w-full max-w-2xl flex-col justify-center gap-3">
		<TabsNavDesktop />

		<div class="mx-auto flex w-full max-w-2xl items-center justify-center gap-3 px-4 sm:px-0">
			<div class="w-full min-w-0 flex-1 md:w-auto">
				<LocationDistanceInput
					inputId="plzCityInput-header"
					{initialLocation}
					initialDistance={eventsStore.pagination.distance}
					{resolvedCityName}
					locationBiasLat={eventsStore.pagination.lat}
					locationBiasLng={eventsStore.pagination.lng}
					onChange={onLocationDistanceChange}
				/>
			</div>

			<button
				type="button"
				data-testid="open-filter-dialog"
				class={[`btn btn-circle relative sm:w-fit sm:px-4`, eventsStore.hasFilterBehindButton && `active`]}
				onclick={openFilterDialog}
			>
				<i class="icon-[ph--sliders] size-5"></i>
				<span class="hidden sm:block">Filter</span>
			</button>
		</div>

		<div class="mx-auto flex w-full max-w-2xl items-center gap-4 px-4 sm:px-0">
			<CategorySelection />
		</div>

		{#if showOfferingsLink}
			<div class="mx-auto flex w-full max-w-2xl">
				<div
					class="text-base-content/80 bg-base-500 sm:bg-base-100 sm:rounded-box -mt-2 flex w-full items-center py-1 pl-3 text-xs sm:-mt-4 sm:mb-3 sm:w-fit sm:text-sm"
				>
					<div class="">
						<div class="inline-block mr-1.5">
							Für private Sessions und Services:
						</div> 
						<div class="inline-block align-middle">
							<a
								href={routes.offeringsList()}
								class="link text-base-content flex items-center gap-1 font-semibold"
							>
								<i class="icon-[ph--hand-heart] size-4"></i>
								Angebote
							</a>
						</div>
					</div>
					<div class="grow"></div>
					<button
						class="btn btn-ghost btn-circle btn-xs mr-2 ml-1"
						aria-label="Offerings-Hinweis ausblenden"
						onclick={() => (showOfferingsLink = false)}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			</div>
		{/if}
	</div>
</header>

<!-- filter dialog -->
<Dialog.Root bind:open={isFilterDialogOpen}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			data-testid="filter-dialog"
			class="bg-base-200 fixed top-1/2 left-1/2 z-50 flex h-full max-h-dvh w-full max-w-dvw -translate-x-1/2 -translate-y-1/2 flex-col shadow-xl sm:max-w-md md:h-auto md:rounded-lg"
			onOpenAutoFocus={(event) => event.preventDefault()}
			onInteractOutside={handleFilterInteractOutside}
		>
			<div class="flex shrink-0 items-center gap-3 px-6 py-4">
				<Dialog.Title class="text-xl leading-none font-semibold">Filter</Dialog.Title>
				<div class="grow"></div>
				<button type="button" class="btn btn-sm shrink-0" onclick={() => eventsStore.resetFilters()}>
					<i class="icon-[ph--arrow-u-up-left] size-4"></i>
					Alle Filter zurücksetzen
				</button>
				<Dialog.Close
					class="btn btn-ghost btn-circle btn-sm shrink-0"
					aria-label="Schließen"
				>
					<i class="icon-[ph--x] size-5"></i>
				</Dialog.Close>
			</div>

			<div class="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
				<div class="flex flex-col items-start gap-3">
					<h3>Zeitraum</h3>
					<DateRangePicker onChange={eventsStore.onDateChange} value={{ start: startDate, end: endDate }} showLongText />
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Entfernung</h3>
					<div class="w-full min-w-0">
						<LocationDistanceInput
							inputId="plzCityInput-dialog"
							{initialLocation}
							initialDistance={eventsStore.pagination.distance}
							{resolvedCityName}
							locationBiasLat={eventsStore.pagination.lat}
							locationBiasLng={eventsStore.pagination.lng}
							onChange={onLocationDistanceChange}
						/>
					</div>
				</div>

				<div class="flex flex-col items-start gap-3">
					<h3>Teilnahme</h3>
					<div class="flex flex-row items-center gap-3">
						<ToggleButton
							checked={eventsStore.pagination.attendanceMode === "offline" || eventsStore.pagination.attendanceMode === "offline+online"}
							onchange={() => {
								if (eventsStore.pagination.attendanceMode === "online") {
									eventsStore.handleAttendanceModeChange("offline+online");
								} else if (eventsStore.pagination.attendanceMode === "offline+online") {
									eventsStore.handleAttendanceModeChange("online");
								} else if (eventsStore.pagination.attendanceMode === "offline") {
									eventsStore.handleAttendanceModeChange(null);
								} else if (!eventsStore.pagination.attendanceMode) {
									eventsStore.handleAttendanceModeChange("offline");
								}
							}}
						>
							Vor Ort
						</ToggleButton>

						<ToggleButton
							checked={eventsStore.pagination.attendanceMode === "online" || eventsStore.pagination.attendanceMode === "offline+online"}
							onchange={() => {
								if (eventsStore.pagination.attendanceMode === "offline") {
									eventsStore.handleAttendanceModeChange("offline+online");
								} else if (eventsStore.pagination.attendanceMode === "offline+online") {
									eventsStore.handleAttendanceModeChange("offline");
								} else if (eventsStore.pagination.attendanceMode === "online") {
									eventsStore.handleAttendanceModeChange(null);
								} else if (!eventsStore.pagination.attendanceMode) {
									eventsStore.handleAttendanceModeChange("online");
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
						<ToggleButton checked={sortByTime} onchange={() => eventsStore.handleSortChanged("time_asc")}>Startzeit</ToggleButton>
						<ToggleButton
							checked={sortByDistance}
							tooltip={eventsStore.pagination.attendanceMode === "online"
								? "Sortieren nach Distanz macht nur für Vorort-Events Sinn"
								: eventsStore.pagination.lat != null && eventsStore.pagination.lng != null
									? ""
									: "Setze zuerst einen Standort"}
							onchange={() => {
								if (eventsStore.pagination.lat != null && eventsStore.pagination.lng != null) {
									eventsStore.handleSortChanged("distance_asc");
								}
							}}
						>
							Distanz
						</ToggleButton>
					</div>
				</div>

				<div class="flex w-full flex-col items-start gap-3">
					<h3>Kategorien</h3>
					<CategorySelection layout="wrap" />
				</div>

				{#if user.isAdmin && eventSources && eventSourceFilter}
					<AdminEventSourceFilter sources={eventSources} initialSource={eventSourceFilter} />
				{/if}
			</div>

			<!-- <div class="grow"></div> -->
			<div class="flex w-full items-center justify-end px-6 pt-3 pb-6">
				<Dialog.Close class="btn btn-primary w-full md:w-auto" data-testid="filter-apply">Ergebnisse anzeigen</Dialog.Close>
			</div>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>

{#snippet filteredIndicator()}
	<div class="bg-primary border-base-100 absolute top-0 right-0 h-3 w-3 rounded-full border-2"></div>
{/snippet}
