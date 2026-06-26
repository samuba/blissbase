<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import OfferingCard from "$lib/components/OfferingCard.svelte";
	import LocationDistanceInput from "$lib/components/LocationDistanceInput.svelte";
	import type { LocationChangeEvent } from "$lib/components/LocationDistanceInput.svelte";
	import TabsNavDesktop from "$lib/components/TabsNavDesktop.svelte";
	import TextSearchInput from "$lib/components/TextSearchInput.svelte";
	import { filterOfferingsBySearchTerm } from "$lib/offeringsFilter";
	import type { OfferingsFilter } from "$lib/offeringsFilter";
	import { saveLocationFiltersToBrowserCookie, setLocationInteractedCookie } from "$lib/cookie-utils";
	import { routes } from "$lib/routes";
	import { showOfferingDetailsDialog } from "./OfferingDetailsDialog.svelte";
	import { flip } from "svelte/animate";
	import { fade } from "svelte/transition";

	let { data } = $props();

	const filter = $derived(data.filter);
	const offerings = $derived(data.offerings);
	const filteredOfferings = $derived(
		filterOfferingsBySearchTerm({
			offerings,
			searchTerm: filter.searchTerm,
		}),
	);

	let searchInput = $state<TextSearchInput | null>(null);
	let headerElement = $state<HTMLElement | null>(null);
	let scrollY = $state(0);
	let contentBeforeMenuHeight = $state(0);
	const showShadow = $derived(scrollY > (headerElement?.offsetHeight ?? 50) + contentBeforeMenuHeight - 100);

	const resolvedCityName = $derived(
		filter.lat != null && filter.lng != null ? filter.plzCity : null,
	);
	const initialLocation = $derived(
		filter.plzCity ||
		(filter.lat != null && filter.lng != null ? `coords:${filter.lat},${filter.lng}` : null),
	);

	const ctaHref = $derived(
		filter.plzCity ? routes.eventList({ searchTerm: filter.plzCity }) : routes.eventList(),
	);

	$effect(() => {
		contentBeforeMenuHeight = document.getElementById(`content-before-menu`)?.clientHeight ?? 0;
	});

	function navigateWithFilter(nextFilter: Partial<OfferingsFilter>) {
		void goto(
			routes.offeringsList({
				plzCity: `plzCity` in nextFilter ? nextFilter.plzCity ?? null : filter.plzCity,
				distance: `distance` in nextFilter ? nextFilter.distance ?? null : filter.distance,
				lat: `lat` in nextFilter ? nextFilter.lat ?? null : filter.lat,
				lng: `lng` in nextFilter ? nextFilter.lng ?? null : filter.lng,
				searchTerm: `searchTerm` in nextFilter ? nextFilter.searchTerm ?? null : filter.searchTerm,
				includeOnline: `includeOnline` in nextFilter ? nextFilter.includeOnline ?? false : filter.includeOnline,
			}),
			{ keepFocus: true, noScroll: true },
		);
	}

	function handleLocationDistanceChange(event: LocationChangeEvent) {
		setLocationInteractedCookie();
		saveLocationFiltersToBrowserCookie({
			plzCity: event.location,
			distance: event.distance,
			lat: event.latitude ?? null,
			lng: event.longitude ?? null,
		});

		navigateWithFilter({
			plzCity: event.location,
			distance: event.distance,
			lat: event.latitude ?? null,
			lng: event.longitude ?? null,
		});
	}

	function handleSearchTermChange(value: string) {
		navigateWithFilter({
			searchTerm: value.trim() || null,
		});
	}

	function handleIncludeOnlineChange(event: Event) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;

		navigateWithFilter({
			includeOnline: target.checked,
		});
	}

	function clearSearch() {
		searchInput?.clearAndFocus();
		navigateWithFilter({ searchTerm: null });
	}

	function newOfferingHref() {
		return routes.newOffering({ returnTo: routes.currentPath(page.url) });
	}

	function openOfferingDetails(offering: (typeof offerings)[number]) {
		showOfferingDetailsDialog(offering, { returnTo: routes.currentPath(page.url) });
	}

	const normalizedSearchTerm = $derived(filter.searchTerm?.trim() ?? ``);
</script>

<svelte:head>
	<title>Angebote | Blissbase</title>
</svelte:head>

<svelte:window bind:scrollY />

<div class="grid w-full overflow-hidden" id="content-before-menu">
	<div class="col-start-1 row-start-1">
		<enhanced:img
			src="/static/offering-hero.jpg?blur=2.5&brightness=0.87"
			alt="Hero image"
			class="w-full md:h-auto md:max-h-[550px] h-72 object-cover md:blur-[2px]"
		/>
	</div>

	<div class="col-start-1 row-start-1 z-10 container mx-auto sm:w-2xl flex flex-col gap-3 items-center justify-center">
		<div class="flex flex-col gap-3 w-full items-center justify-center px-4">
			<h1 class="md:text-5xl text-4xl font-semibold text-base-100 font-brand">Angebote</h1>
		</div>

		<h2 class="text-xl md:text-2xl bg-gradient-to-r from-base-100 to-base-100 bg-clip-text text-transparent text-center font-brand">
			✨ Aus der Community für die Community ✨
		</h2>
	</div>
</div>

<div class="flex w-full flex-col items-center justify-center pb-4">
	<header
		bind:this={headerElement}
		class={[
			`z-10 w-full bg-base-200 sticky top-0 pt-4`,
			`pb-3`
		]}
		id="header-controls"
	>
		{#if showShadow}
			<div
				class="pointer-events-none absolute right-0 left-0 z-20 h-6"
				style="top: 100%; background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.03) 50%, transparent 100%);"
			></div>
		{/if}

		<div class="mx-auto flex w-full max-w-3xl flex-col justify-center gap-3">
			<TabsNavDesktop />

			<div class="flex w-full flex-col gap-3 px-4 sm:flex-row sm:items-end">
				<div class="flex w-full flex-col gap-1.5">
					<LocationDistanceInput
						inputId="plzCityInput-offerings"
						initialLocation={initialLocation}
						initialDistance={filter.distance}
						resolvedCityName={resolvedCityName}
						locationBiasLat={filter.lat}
						locationBiasLng={filter.lng}
						onChange={handleLocationDistanceChange}
					/>
				</div>

				<div class="flex w-full flex-col gap-1.5">
					<TextSearchInput
						bind:this={searchInput}
						id="offering-search"
						query={filter.searchTerm ?? ``}
						searched={Boolean(filter.searchTerm?.trim())}
						wrapperClass="w-full"
						onSearch={handleSearchTermChange}
						onClose={() => navigateWithFilter({ searchTerm: null })}
					/>
				</div>
			</div>

			<label class="label cursor-pointer justify-start gap-2 px-4 sm:-mt-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm bg-base-100"
					checked={filter.includeOnline}
					onchange={handleIncludeOnlineChange}
				/>
				<span class="text-sm">Online Angebote auch anzeigen</span>
			</label>
		</div>
	</header>

	<div class="mx-auto mb-2 w-full max-w-5xl pt-4 sm:mb-4">
		<div class="px-4">
			{#if filteredOfferings.length}
				<div class="grid gap-4 min-[920px]:grid-cols-2">
					<div class="border-primary rounded-box bg-primary/20 flex flex-col gap-2 border-2 border-dashed p-4">
						<span class="md:card-title text-primary-content mt-2">Was willst du der Community geben?</span>
						<p class="text-primary-content/80 hidden md:block">
							Egal ob private Breathwork Session, Coaching, Massage, Reiki oder Tarot Readings - Hier kannst du es der Community anbieten.
						</p>
						<a href={newOfferingHref()} class="btn btn-primary mt-2 w-fit">
							<i class="icon-[ph--plus] size-5"></i>
							Angebot erstellen
						</a>
					</div>
					{#each filteredOfferings as offering (offering.id)}
						<div class="h-full" animate:flip={{ duration: 200 }} out:fade={{ duration: 200 }} in:fade={{ duration: 200 }}>
							<OfferingCard {offering} onclick={() => openOfferingDetails(offering)} />
						</div>
					{/each}
				</div>

				{#if normalizedSearchTerm}
					<section class="">
						<div class="card-body items-center py-12 text-center">
							<h2 class="card-title mt-2">Keine weiteren Suchergebnisse für "{normalizedSearchTerm}"</h2>
							<p class="text-base-content/70 max-w-md">Ändere deine Suche oder lösche den Suchbegriff, um wieder alle Angebote zu sehen.</p>
							<button type="button" class="btn btn-primary mt-2" onclick={clearSearch}> Suche löschen </button>
						</div>
					</section>
				{/if}
			{:else if normalizedSearchTerm}
				<section class="">
					<div class="card-body items-center py-12 text-center">
						<h2 class="card-title mt-2">Keine passenden Angebote</h2>
						<p class="text-base-content/70 max-w-md">Ändere deine Suche oder lösche den Suchbegriff, um wieder alle Angebote zu sehen.</p>
						<button type="button" class="btn btn-primary mt-2" onclick={clearSearch}> Suche löschen </button>
					</div>
				</section>
			{:else}
				<section class="card bg-base-100 shadow-sm">
					<div class="card-body items-center py-12 text-center">
						<div class="bg-primary/15 text-primary flex size-16 items-center justify-center rounded-full">
							<i class="icon-[ph--hand-heart] size-8"></i>
						</div>
						<h2 class="card-title mt-2">Noch keine Angebote hier</h2>
						<p class="text-base-content/70 max-w-md">Erstelle das erste Angebot für diesen Bereich oder schau später wieder vorbei.</p>
						<a href={newOfferingHref()} class="btn btn-primary mt-2"> Angebot erstellen </a>
					</div>
				</section>
			{/if}

			<section class="card bg-base-100 mt-4 shadow-sm">
				<div class="card-body flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
					<div>
						<h2 class="card-title">
							<i class="icon-[ph--calendar] size-6"></i>
							Suchst du Events?
						</h2>
						<p class="text-base-content/70 text-sm">Wir haben sehr viele!</p>
					</div>
					<a href={ctaHref} class="btn">
						Events anzeigen
						<i class="icon-[ph--arrow-right] size-5"></i>
					</a>
				</div>
			</section>
		</div>
	</div>
</div>
