<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { stripHtml, trimAllWhitespaces } from "$lib/common";
	import OfferingCard from "$lib/components/OfferingCard.svelte";
	import Select from "$lib/components/Select.svelte";
	import { OFFERING_PLACE_FILTERS, type OfferingPlaceFilter } from "$lib/rpc/offerings.common";
	import { getOfferings } from "$lib/rpc/offerings.remote";
	import { routes } from "$lib/routes";
	import { showOfferingDetailsDialog } from "./OfferingDetailsDialog.svelte";
	import { flip } from "svelte/animate";
	import { fade } from "svelte/transition";

	const requestedFilter = $derived(normalizeFilter(page.url.searchParams.get(`place`)));
	const result = $derived(await getOfferings({ filter: requestedFilter }));
	const offerings = $derived(result.offerings);
	const filter = $derived(result.filter);
	let searchTerm = $state(``);
	let searchInput = $state<HTMLInputElement | null>(null);

	const filters: Array<{ value: OfferingPlaceFilter; label: string; icon: string }> = [
		{ value: `online`, label: `Online`, icon: `icon-[ph--globe]` },
		{ value: `danang`, label: `Danang`, icon: `icon-[ph--map-pin]` },
		{ value: `hoi-an`, label: `Hoi An`, icon: `icon-[ph--map-pin]` },
		{ value: `danang-hoi-an`, label: `Danang & Hoi An`, icon: `icon-[ph--map-pin]` },
	];

	const filterOptions = filters.map((filterOption) => ({
		value: filterOption.value,
		html: `<i class="${filterOption.icon} size-4"></i><span>${filterOption.label}</span>`,
	}));

	let selectedFilter = $derived<OfferingPlaceFilter>(requestedFilter);
	const normalizedSearchTerm = $derived(searchTerm.trim().toLocaleLowerCase());
	const filteredOfferings = $derived.by(() => {
		if (!normalizedSearchTerm) return offerings;
		return offerings.filter((offering) => {
			const title = offering.title.toLocaleLowerCase();
			const description = (trimAllWhitespaces(stripHtml(offering.descriptionHtml)) ?? ``).toLocaleLowerCase();
			const host = offering.profile.displayName?.toLocaleLowerCase();

			return title.includes(normalizedSearchTerm) || description.includes(normalizedSearchTerm) || host?.includes(normalizedSearchTerm);
		});
	});

	const ctaHref = $derived.by(() => {
		if (filter === `danang`) return routes.eventList({ searchTerm: `Da Nang` });
		if (filter === `hoi-an`) return routes.eventList({ searchTerm: `Hoi An` });
		return routes.eventList();
	});

	function normalizeFilter(value: string | null): OfferingPlaceFilter {
		if (OFFERING_PLACE_FILTERS.includes(value as OfferingPlaceFilter)) {
			return value as OfferingPlaceFilter;
		}
		return `online`;
	}

	function onFilterChange(value: string) {
		const nextFilter = normalizeFilter(value);
		if (nextFilter === requestedFilter) return;
		void goto(routes.offeringsList(nextFilter));
	}

	function clearSearch() {
		searchTerm = ``;
		searchInput?.focus();
	}

	function newOfferingHref() {
		return routes.newOffering({ returnTo: routes.currentPath(page.url) });
	}

	function openOfferingDetails(offering: (typeof offerings)[number]) {
		showOfferingDetailsDialog(offering, { returnTo: routes.currentPath(page.url) });
	}
</script>

<svelte:head>
	<title>Angebote | Blissbase</title>
</svelte:head>

<div class="mx-auto mb-2 w-full max-w-5xl sm:mb-4">
	<div class="card bg-base-100 lg:rounded-box mb-4 w-full rounded-none p-6 shadow">
		<header class="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
			<div class="max-w-2xl">
				<div class="flex items-center gap-4">
					<div class="bg-primary/25 text-primary-content rounded-box flex items-center justify-center p-2">
						<i class="icon-[ph--hand-heart] size-10"></i>
					</div>
					<div class="flex flex-col justify-center">
						<h1 class="-mt-0.5 text-2xl font-bold">Angebote</h1>
						<p class="text-base-content/70 text-sm">Finde Sessions, Services und Unterstützung.</p>
					</div>
				</div>
			</div>

			<!-- <div class="w-full sm:w-auto">
				<a href={routes.newOffering()} class="btn btn-primary w-full  sm:shrink-0">
					<i class="icon-[ph--plus] size-5"></i>
					Angebot erstellen
				</a>
			</div> -->
		</header>

		<div class="flex flex-col gap-4 sm:flex-row sm:items-end">
			<div class="flex w-full max-w-xs flex-col gap-1.5">
				<span id="offering-location-label" class="hidden text-sm font-medium sm:block">Ort auswählen</span>
				<Select
					bind:value={selectedFilter}
					options={filterOptions}
					placeholder="Ort wählen"
					triggerProps={{
						class: `w-full justify-between text-left`,
						"aria-labelledby": `offering-location-label`,
					}}
					onValueChange={onFilterChange}
				/>
			</div>

			<div class="flex w-full max-w-xs flex-col gap-1.5">
				<label for="offering-search" class="hidden text-sm font-medium sm:block">Suche</label>
				<div class="relative">
					<label class="input">
						<i class="icon-[ph--magnifying-glass] size-5"></i>
						<input
							id="offering-search"
							type="text"
							bind:this={searchInput}
							bind:value={searchTerm}
							placeholder="Titel oder Beschreibung"
							class={[`grow`, normalizedSearchTerm && `active`]}
						/>
						{#if normalizedSearchTerm}
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-circle absolute top-1/2 right-2 -translate-y-1/2"
								aria-label="Suche löschen"
								onclick={clearSearch}
							>
								<i class="icon-[ph--x] size-4"></i>
							</button>
						{/if}
					</label>
				</div>
			</div>
		</div>
	</div>

	<div class="px-4 lg:px-0">
		{#if filteredOfferings.length}
			<div class="grid gap-4 md:grid-cols-2">
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

