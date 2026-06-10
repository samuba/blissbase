<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import OfferingCard from '$lib/components/OfferingCard.svelte';
	import ProfileContactButtons from '$lib/components/ProfileContactButtons.svelte';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import OfferingDetailsDialog, { showOfferingDetailsDialog } from '../../offerings/OfferingDetailsDialog.svelte';
	import { fade } from 'svelte/transition';

	let { data } = $props();
	const { profile, upcomingEvents, publicOfferings, userId } = $derived(data);
	const isOwnProfile = $derived(Boolean(profile.id === userId));
	let selectedTab = $state<ProfileTab>(getInitialSelectedTab());

	function getInitialSelectedTab(): ProfileTab {
		if (!data.upcomingEvents?.length && data.publicOfferings?.length) return `offerings`;

		return `events`;
	}

	function selectTab(tab: ProfileTab) {
		selectedTab = tab;
	}

	function openOfferingDetails(offering: (typeof publicOfferings)[number]) {
		selectedTab = `offerings`;
		showOfferingDetailsDialog(offering, {
			returnTo: offering.slug
				? routes.offeringDialog({ returnTo: routes.currentPath(page.url), offeringSlug: offering.slug })
				: routes.currentPath(page.url),
		});
	}

	type ProfileTab = `events` | `offerings`;
</script>

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 sm:pt-4 md:pt-0">
	<div class="bg-base-100 sm:rounded-box overflow-hidden shadow">
		<div class="relative">
			{#if profile.bannerImageUrl}
				<div class="bg-base-200 aspect-2/1 w-full overflow-hidden sm:aspect-3/1">
					<img src={profile.bannerImageUrl} alt="" class="size-full object-cover" />
				</div>
			{/if}

			<div
				class={[
					`flex flex-col items-center gap-6 px-4 pb-6`,
					profile.bannerImageUrl ? `-mt-17` : `pt-8`
				]}
			>
				<div
					class="relative flex w-full max-w-sm flex-row items-center justify-center drop-shadow sm:w-fit sm:max-w-none"
				>
					{#if profile.profileImageUrl}
						<img
							src={profile.profileImageUrl}
							alt=""
							class={[
								`border-base-100 bg-base-100 z-10 size-32 shrink-0 rounded-full border-4 object-cover`,
								profile.bannerImageUrl ? `` : `mt-0`
							]}
						/>
					{:else}
						<div
							class={[
								`border-base-100 bg-primary/15 text-primary z-10 flex size-28 shrink-0 items-center justify-center rounded-full border-4 sm:size-32`
							]}
						>
							<i class="icon-[ph--user-circle] size-14"></i>
						</div>
					{/if}

					<div
						class="bg-base-100 rounded-box relative -ml-6 flex w-fit max-w-[calc(100%-6.5rem)] min-w-0 flex-none flex-col items-start justify-center gap-3 rounded-l-none px-5 py-4 pl-10 text-left sm:max-w-md"
					>
						<div class="flex w-full items-start justify-between gap-2">
							<div class="flex min-w-0 flex-col items-start gap-1">
								<h1
									class="relative inline-block max-w-full text-left text-xl font-bold tracking-tight wrap-break-word"
								>
									{profile.displayName}
								</h1>

								{#if profile.place?.name?.trim()}
									<a
										href={resolve(`/p/[slug]`, { slug: profile.place.slug })}
										class="text-base-content/60 flex min-w-0 items-center justify-start gap-1 text-sm"
									>
										<i class="icon-[ph--map-pin] size-4" aria-hidden="true"></i>
										<span class="min-w-0 wrap-break-word">{profile.place.name}</span>
									</a>
								{/if}
							</div>
							{#if isOwnProfile}
								<a
									href={resolve(`/profile/public`)}
									class="btn btn-circle btn-sm"
									title="Profil bearbeiten"
								>
									<i class="icon-[ph--pencil] size-4"></i>
								</a>
							{/if}
						</div>
					</div>
				</div>

				<ProfileContactButtons socialLinks={profile.socialLinks} />

				<div class=" gap-6 pt-0 sm:mx-4">
					{#if profile.bio?.trim()}
						<div class={['prose max-w-none', profile.bio.length < 180 && `text-center`]}>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- public profile bio is stored from the trusted EditorJS form. -->
							{@html profile.bio}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="my-4 px-4 sm:px-0">
		<div role="tablist" class="tabs tabs-box bg-base-300 flex flex-row justify-center">
			<button
				role="tab"
				class={[`tab grow`, selectedTab === `events` ? `tab-active` : 'text-base-content/60 hover:text-base-content']}
				onclick={() => selectTab(`events`)}
			>
				<i class="icon-[ph--calendar] size-5 mr-2"></i>
				Events
			</button>

			<button
				role="tab"
				class={[`tab grow `, selectedTab === `offerings` ? `tab-active` : 'text-base-content/60 hover:text-base-content']}
				onclick={() => selectTab(`offerings`)}
			>
				<i class="icon-[ph--hand-heart] size-5 mr-2"></i>
				Angebote
			</button>
		</div>

		{#if selectedTab === `events`}
			<div transition:fade={{ duration: 200 }}>
				{#if upcomingEvents?.length}
					<div class="mt-4 flex w-full flex-col gap-4">
						{#each upcomingEvents as event (event.id)}
							<EventCard {event} />
						{/each}
					</div>
				{:else}
					<p class="text-base-content/60 mt-4 text-sm">Aktuell keine kommenden Events.</p>
				{/if}
			</div>
		{/if}
			
		{#if selectedTab === `offerings`}
		<div transition:fade={{ duration: 200 }}>
			{#if publicOfferings?.length}
				<div class="mt-4 flex w-full flex-col gap-4">
					{#each publicOfferings as offering (offering.id)}
						<OfferingCard {offering} showAuthor={false} onclick={() => openOfferingDetails(offering)} />
					{/each}
				</div>
			{:else}
				<p class="text-base-content/60 mt-4 text-sm">Aktuell keine Angebote.</p>
			{/if}
		</div>
		{/if}
	</div>

	<div class="flex w-full justify-center gap-6 my-6">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>
</div>

<OfferingDetailsDialog offerings={publicOfferings} />

<style>
	:global(.prose a) {
		text-decoration: underline;
	}

	:global(.prose p) {
		margin-bottom: 0.3rem;
		margin-top: 0.3rem;
	}
</style>
