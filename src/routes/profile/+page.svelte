<script lang="ts">
	import { getUserSession } from '$lib/rpc/auth.remote';
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { getMyAuthoredPastEvents, getMyAuthoredUpcomingEvents } from '$lib/rpc/events.remote';
	import { getMyPublicProfile } from '$lib/rpc/profile.remote';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import EventCard from '$lib/components/EventCard.svelte';

	let isLoggingOut = $state(false);
	const session = await getUserSession();
	const myPublic = await getMyPublicProfile();
	let selectedTab = $state<`upcoming` | `past`>(`upcoming`);

	const upcomingEvents = await getMyAuthoredUpcomingEvents();

	let pastEvents = $state<typeof upcomingEvents>([]);
	let pastEventsStatus = $state<`idle` | `loading` | `loaded`>(`idle`);


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
	<div class="card bg-base-100 mt-4 shadow">
		<div class="card-body gap-4">
			<div class="flex items-start gap-3">
				<div class="bg-primary/15 text-primary-content rounded-xl p-2.5">
					<i class="icon-[ph--identification-card] size-7"></i>
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<h3 class="text-lg font-semibold">Öffentliches Profil</h3>
					<p class="text-base-content/80 text-sm leading-relaxed">
						{#if (myPublic.isPublic && myPublic.slug)}
							Dein öffentliches Profil ist sichtbar unter 
							<a href="https://blissbase.app/@/{myPublic.slug}" class="link">
								blissbase.app/@/{myPublic.slug}
							</a>
						{:else}
							Erstelle dein öffentliches Profil.
						{/if}
					</p>
					<div class="card-actions pt-1 gap-4">
						<a href={resolve(routes.editPublicProfile())} class="btn btn-primary">
							{#if myPublic.isPublic && myPublic.slug}
								Profil bearbeiten
							{:else}
								Profil erstellen
							{/if}
						</a>
						{#if myPublic.isPublic && myPublic.slug?.trim()}
							<a href={resolve(`/@/[slug]`, { slug: myPublic.slug })} class="btn">
								<i class="icon-[ph--eye] size-4"></i>
								Profil ansehen
							</a>
						{/if}
					</div>
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