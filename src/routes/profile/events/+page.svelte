<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import { getMyAuthoredPastEvents, getMyAuthoredUpcomingEvents } from '$lib/rpc/events.remote';
	import { routes } from '$lib/routes';

	let { data } = $props();
	let selectedTab = $state<`upcoming` | `past`>(`upcoming`);
	let pastEventsRequested = $state(false);

	const upcomingEventsQuery = getMyAuthoredUpcomingEvents();
	const upcomingEvents = $derived(upcomingEventsQuery.current ?? data.upcomingEvents);
	const pastEventsQuery = $derived(pastEventsRequested ? getMyAuthoredPastEvents() : undefined);
	const pastEvents = $derived(pastEventsQuery?.current ?? []);
	const pastEventsLoading = $derived(Boolean(pastEventsQuery?.loading && !pastEventsQuery.current));

	function fetchPastEvents() {
		pastEventsRequested = true;
	}

	function selectTab(tab: `upcoming` | `past`) {
		if (selectedTab === tab) return;
		selectedTab = tab;
		if (tab !== `past`) return;
		fetchPastEvents();
	}
</script>

<svelte:head>
	<title>Meine Events | Blissbase</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-xl font-bold">Meine Events</h1>
	</div>
	<p class="text-base-content/60 text-sm leading-relaxed">
		Verwalte deine Events. Sie sind für andere Nutzer auf der
		<a href={routes.eventList()} class="link">Events-Seite</a> sichtbar.
	</p>

	<div class="my-4">
		<a href={routes.newEvent()} class="btn btn-primary w-full sm:w-auto">
			<i class="icon-[ph--plus] size-4"></i>
			Event erstellen
		</a>
	</div>

	<div role="tablist" class="tabs tabs-box mt-3 bg-base-300 flex justify-center flex-row">
		<button
			role="tab"
			class={[`tab grow`, selectedTab === `upcoming` && `tab-active`]}
			onclick={() => selectTab(`upcoming`)}
		>
			Aktuelle Events
		</button>

		<button
			role="tab"
			class={[`tab grow`, selectedTab === `past` && `tab-active`]}
			onclick={() => selectTab(`past`)}
			onpointerdown={fetchPastEvents}
			onmouseenter={fetchPastEvents}
			onfocus={fetchPastEvents}
		>
			Vergangene Events
		</button>
	</div>

	<div class={[selectedTab !== `upcoming` && `hidden`]}>
		{#if upcomingEvents.length}
			<div class="mt-4 flex w-full flex-col gap-6">
				{#each upcomingEvents as event (event.id)}
					<EventCard {event} />
				{/each}
			</div>
		{:else}
			<div class="text-base-content/60 mt-12 flex flex-col items-center gap-3 text-center">
				<span>Du hast aktuell keine Events.</span>
				<a href={routes.newEvent()} class="btn btn-primary btn-sm w-fit">Event erstellen</a>
			</div>
		{/if}
	</div>

	<div class={[selectedTab !== `past` && `hidden`]}>
		{#if pastEventsLoading}
			<div class="mt-12 flex justify-center">
				<span class="loading loading-spinner"></span>
			</div>
		{:else if pastEvents.length}
			<div class="mt-4 flex w-full flex-col gap-6">
				{#each pastEvents as event (event.id)}
					<EventCard {event} />
				{/each}
			</div>
		{:else}
			<div class="mt-12 text-center text-base-content/60">
				Du hast noch keine vergangenen Events.
			</div>
		{/if}
	</div>
</div>
