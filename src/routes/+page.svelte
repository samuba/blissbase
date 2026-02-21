<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import { page } from '$app/state';
	import EventDetailsDialog from './EventDetailsDialog.svelte';
	import { intersect } from '$lib/attachments/intersection';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import HeaderControls from '$lib/components/HeaderControls.svelte';
	import { browser } from '$app/environment';
	import InstallButton from '$lib/components/install-button/InstallButton.svelte';
	import { setLocationInteractedCookie } from '$lib/cookie-utils';

	const { data } = $props();
	const { userId, autoDetectedCity } = $derived(data);

	let contentBeforeMenu = $state<HTMLElement | null>(null);
	let dismissedAutoLocationHint = $state(false);
	const showAutoLocationHint = $derived(Boolean(autoDetectedCity) && !dismissedAutoLocationHint);

	// Always initialize from server data during SSR to prevent state pollution
	// On client, only initialize if store is empty (preserves navigation state)
	if (!browser || eventsStore.events.length === 0) {
		console.log('Initializing events store from server data');
		eventsStore.initialize({
			events: data.events,
			pagination: {
				...data.pagination,
				startDate: data.pagination.startDate ?? null,
				endDate: data.pagination.endDate ?? null
			}
		});
	}

	$effect(() => {
		if (eventsStore.isLoading && !eventsStore.isLoadingMore) {
			document.getElementById('events-loading-spinner')?.scrollIntoView(true);
		}
	});

	const noResultsContainerClasses = `flex flex-col items-center justify-center gap-3 h-[calc(100vh-8rem)]`
</script>


<div bind:this={contentBeforeMenu} class="grid w-full overflow-hidden" id="content-before-menu">
	<!-- hero image layer -->
	<div class="col-start-1 row-start-1">
		<enhanced:img 
			src="/static/hero.jpg?blur=2&brightness=0.87"
			alt="Hero image"
			class="w-full md:h-auto md:max-h-[550px] h-72 object-cover md:blur-[2px]"
		/>
	</div>

	<!-- Content layer -->
	<div class="col-start-1 row-start-1 z-10 container mx-auto sm:w-2xl flex flex-col gap-14 items-center justify-center">
		<div class="flex flex-col gap-3 w-full items-center justify-center px-4 ">
			<div class="flex justify-center items-center gap-3">
				<img src="/logo.svg" alt="Blissbase" class="md:size-16 size-12" />
				<h1 class="md:text-5xl text-4xl font-semibold text-base-100 font-brand" >
					Blissbase
				</h1>
			</div>

			<h2 class="text-xl md:text-2xl bg-gradient-to-r from-base-100 to-base-100 bg-clip-text text-transparent text-center font-brand">
				✨ Achtsame Events in deiner Nähe ✨
			</h2>
		</div>


		<InstallButton class=""  />
	</div>
</div>
	
<div class="container mx-auto flex flex-col items-center justify-center pb-4 sm:w-2xl">
	
	{#if showAutoLocationHint}
		<div class="px-4 w-full mt-4">
			<div class="alert bg-base-100 mb-2 relative alert-horizontal">
				<i class="icon-[ph--info] size-6 shrink-0"></i>
				<span class="w-full">
					Dir werden Events um <b>{autoDetectedCity}</b> angezeigt.
					Wenn das nicht dein Standort ist, ändere ihn unten.
				</span>
				<button
					class="btn btn-circle btn-ghost btn-sm p-0.25"
					aria-label="Hinweis schließen"
					onclick={() => {
						dismissedAutoLocationHint = true;
						setLocationInteractedCookie();
					}}
				>
					<i class="icon-[ph--x] size-4"></i>
				</button>
			</div>
		</div>
	{/if}

	<HeaderControls {userId} />

	<svelte:boundary>
		<div class="px-4">
			{#if eventsStore.isLoading}
				{@render loading(true)}
			{:else if (eventsStore.pagination.plzCity?.trim() && !eventsStore.pagination.lat)}
				<div class={noResultsContainerClasses}>
					<div class="text-center text-gray-500 flex flex-col justify-center items-center gap-3">
						<i class="icon-[ph--gps-slash] size-10  block"></i>
						<span>

							Ort <b>"{eventsStore.pagination.plzCity}"</b> nicht gefunden
						</span>
					</div>
				</div>
			{:else if eventsStore.hasEvents}
				<div class="fade-in flex w-full flex-col items-center gap-6">
					{#each eventsStore.events as event, i (event.id)}
						<EventCard {event} hidePastEvent />
					{/each}
	
					<div
						{@attach intersect({ onIntersecting: eventsStore.loadMoreEvents })}
						class="-translate-y-72"
					/>
	
					{#if eventsStore.isLoadingMore}
						{@render loading(false)}
					{/if}
				</div>
			{:else}
			<div class={noResultsContainerClasses}>
					<div class="text-gray-500 text-center">
						Keine Events gefunden
						{#if eventsStore.hasSearchFilter}
							mit <br /> {@html eventsStore.searchFilter?.split(' ').map(x => `<b>${x}</b>`).join(' & ')}<br />
						{/if}
						{#if eventsStore.hasLocationFilter}
							in <br /> <span class="font-bold">{eventsStore.locationFilter.plzCity} ({eventsStore.locationFilter.distance}km radius)</span><br />
						{/if}
						{#if eventsStore.hasDateFilter}
							vom <br /> <span class="font-bold">{new Date(eventsStore.dateFilter.start!).toLocaleDateString('de-DE', { dateStyle: 'medium' })}</span> bis <br /> <span class="font-bold">{new Date(eventsStore.dateFilter.end!).toLocaleDateString('de-DE', { dateStyle: 'medium' })}</span><br />
						{/if}
					</div>
				</div>
			{/if}
		</div>

		{#snippet failed(error, reset)}
			<div role="alert" class="alert alert-error">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<b>Fehler beim Laden der Events:</b>
				{error instanceof Error ? error.message : String(error)}
			</div>
		{/snippet}
	</svelte:boundary>
</div>

{#snippet loading(reserveVerticalSpace: boolean)}
	<div class={["mb-3 flex flex-col items-center justify-center gap-2", reserveVerticalSpace && 'h-dvh']}
		id="events-loading-spinner" 
	>
		<img src="/logo.svg" alt="Blissbase" class="size-10 min-w-10 animate-spin" />
		<p class="">Lade...</p>
	</div>
{/snippet}

<EventDetailsDialog event={eventsStore.getEventById(page.state.selectedEventId ?? null)} />
