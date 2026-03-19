<script lang="ts">
	import { getUserSession } from '$lib/rpc/auth.remote';
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { getMyAuthoredPastEvents, getMyAuthoredUpcomingEvents } from '$lib/rpc/events.remote';
	import EventCard from '$lib/components/EventCard.svelte';
	import EventDetailsDialog from '../EventDetailsDialog.svelte';
	import { page } from '$app/state';

	let isLoggingOut = $state(false);
	const session = await getUserSession();
	let selectedTab = $state<`upcoming` | `past`>(`upcoming`);

	const upcomingEvents = await getMyAuthoredUpcomingEvents();

	let pastEventsQuery = getMyAuthoredPastEvents;
	let pastEvents = $state<typeof upcomingEvents>([]);
	let pastEventsStatus = $state<`idle` | `loading` | `loaded`>(`idle`);

	const selectedEvent = $derived.by(() => {
		const selectedEventId = page.state.selectedEventId;
		if (!selectedEventId) return undefined;

		const event = upcomingEvents.find((x) => x.id === selectedEventId);
		if (event) return event;

		return pastEvents.find((x) => x.id === selectedEventId);
	});

	async function fetchPastEvents() {
		if (pastEventsStatus !== `idle`) return;

		pastEventsStatus = `loading`;
		pastEvents = await getMyAuthoredPastEvents();
		pastEventsStatus = `loaded`;
	}

	async function selectTab(tab: `upcoming` | `past`) {
		if (selectedTab === tab) return;
		selectedTab = tab;

		if (tab !== `past`) return;
		await fetchPastEvents();
	}

	async function handleLogout() {
		if (isLoggingOut) return;

		isLoggingOut = true;

		try {
			const supabase = getSupabaseBrowserClient();
			await supabase.auth.signOut();
		} catch (error) {
			console.error(`Logout error:`, error);
		} finally {
			isLoggingOut = false;
		}
	}
</script>


<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 shadow">
		<div class="card-body gap-6">
			<div class="flex items-start gap-4">
				<div class="rounded-2xl bg-primary/12 p-3 text-primary-content">
					<i class="icon-[ph--user-circle] size-8"></i>
				</div>
				<div class="space-y-2">
					<h2 class="text-2xl font-bold">Meine Bereiche</h2>
					<p class="text-base-content/70">
						Hier findest du deine persönlichen Bereiche und schnelle Wege zu deinen wichtigsten Aktionen.
					</p>
				</div>
			</div>
		</div>
	</div>

	<div class="card shadow bg-base-100 mt-4">
		<!-- <i class="icon-[ph--check-circle] size-5"></i> -->
		<div class="flex flex-col gap-3 card-body">
			<span>Du bist eingeloggt als <strong>{session.email}</strong></span>
			<button class="btn btn-warning w-fit" onclick={handleLogout} disabled={isLoggingOut}>
				{#if isLoggingOut}
					<span class="loading loading-spinner loading-sm"></span>
					Wird abgemeldet...
				{:else}
					<i class="icon-[ph--sign-out] size-5"></i>
					Abmelden
				{/if}
			</button>
		</div>
	</div>

	<div class="mt-8">
		<h3 class="text-lg font-semibold">Meine erstellten Events</h3>

		<div role="tablist" class="tabs tabs-box mt-3 bg-base-300 flex justify-center flex-row">
			<button
				role="tab"
				class="tab grow"
				class:tab-active={selectedTab === `upcoming`}
				onclick={() => selectTab(`upcoming`)}
			>
				Aktuelle Events
			</button>

			<button
				role="tab"
				class="tab grow"
				class:tab-active={selectedTab === `past`}
				onclick={() => selectTab(`past`)}
				onpointerdown={fetchPastEvents}
				onmouseenter={fetchPastEvents}
				onfocus={fetchPastEvents}
			>
				Vergangene Events
			</button>
		</div>

		<div class:hidden={selectedTab !== `upcoming`}>
			{#if upcomingEvents.length}
				<div class="mt-4 flex w-full flex-col gap-6">
					{#each upcomingEvents as event (event.id)}
						<EventCard {event} />
					{/each}
				</div>
			{:else}
				<div class="mt-12 text-center text-base-content/60">
					Du hast aktuell keine Events.
				</div>
			{/if}
		</div>

		<div class:hidden={selectedTab !== `past`}>
			{#if pastEventsStatus === `loading`}
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
</div>

<EventDetailsDialog event={selectedEvent} />
