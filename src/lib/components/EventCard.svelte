<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { addHours, formatAddress, formatTimeStr } from '$lib/common';
	import { pushState } from '$app/navigation';
	import { routes } from '$lib/routes';
	import RandomPlaceholderImg from './RandomPlaceholderImg.svelte';
	import LoginDialog from './LoginDialog.svelte';
	import FavoriteButton from './FavoriteButton.svelte';
	import { now } from '$lib/now.svelte';
	import { localeStore } from '../../locales/localeStore.svelte';

	const {
		event,
		class: className,
		onAddFavorite,
		onRemoveFavorite,
		hidePastEvent
	}: {
		event: UiEvent;
		class?: string;
		onAddFavorite?: (eventId: number) => void | undefined;
		onRemoveFavorite?: (eventId: number) => void | undefined;
		hidePastEvent?: boolean;
	} = $props();

	let imageLoadError = $state(false);
	const imageUrl = $derived(event.imageUrls?.[0]);

	const isPast = $derived((event.endAt ?? addHours(event.startAt, 4)) < now.value);
	const isOngoing = $derived(event.startAt < now.value && (event.endAt ?? addHours(event.startAt, 4) > now.value));
	const hideEvent = $derived.by(() => {
		if (!hidePastEvent) return false;

		// hide events that have elapsed for more than 30% of their duration or 4 hours after start if no end time is set
		const endTime = event.endAt ?? addHours(event.startAt, 4);
		const totalDuration = endTime.getTime() - event.startAt.getTime();
		const elapsed = now.value.getTime() - event.startAt.getTime();
		return elapsed / totalDuration > 0.3;
	});

	function handleClick(e: MouseEvent) {
		e.preventDefault();
		pushState(routes.eventDetails(event.slug), { selectedEventId: event.id });
	}

	const tags = $derived.by(() => {
		const tags = new Set<string>();
		event.tags2?.filter((x) => x.locale === localeStore.locale)?.forEach((x) => tags.add(x.name));
		event.tags?.forEach((x) => {
			if (x[localeStore.locale]) tags.add(x[localeStore.locale]);
			else tags.add(x);
		});
		return Array.from(tags);
	});

	let showLoginDialog = $state(false);
</script>

<LoginDialog bind:open={showLoginDialog} />

{#if !hideEvent}
	<a
		href={routes.eventDetails(event.slug)}
		class=" w-full"
		data-sveltekit-preload-data="false"
		onclick={handleClick}
	> 
		<article
			class="card bg-base-100 fade-out-0 flex flex-col rounded-lg shadow-sm transition-all sm:flex-row {className}"
			data-event-id={event.id}
			data-testid="event-card"
		>
			<div
				class={[
					'from-base-200/50 to-base-300 relative min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-l-lg sm:rounded-tr-none'
				]}
			>
				<FavoriteButton
					eventId={event.id}
					class="absolute right-2 bottom-2 z-5"
					{onAddFavorite}
					{onRemoveFavorite}
				/>

				{#if imageUrl}
					<div
						class="h-full rounded-t-lg bg-cover bg-center"
						style="background-image: url({imageUrl})"
					>
						<figure
							class="h-full rounded-t-lg backdrop-blur-md backdrop-brightness-85 sm:rounded-l-lg sm:rounded-tr-none"
						>
							<img
								src={imageUrl}
								alt="illustration for event: {event.name}"
								class="h-full max-h-72 max-w-full object-cover sm:max-h-54"
								onerror={() => (imageLoadError = true)}
							/>
						</figure>
					</div>
				{:else}
					<RandomPlaceholderImg
						seed={event.name}
						class="h-full max-h-38 rounded-t-lg sm:max-h-none  sm:scale-170 sm:rounded-l-lg sm:rounded-tr-none"
					/>
				{/if}
			</div>

			<div class="card-body flex flex-col gap-2 pt-4.5 md:pt-6">
				<h3 class="card-title leading-snug tracking-tight">
					{event.name}

					{#if event.soldOut}
						<span class="badge badge-sm badge-ghost ml-1">Ausgebucht</span>
					{/if}
				</h3>

				<div class="flex items-center gap-1 flex-wrap">
					<!-- <i class="icon-[ph--clock] mr-1.5 size-4 min-w-4"></i> -->
					<span>
						{formatTimeStr(event.startAt, event.endAt, localeStore.locale)}
					</span>
					
					{#if isPast}
						<div class="badge badge-secondary badge-sm ml-2">
							Vorbei
						</div>
					{:else if isOngoing}
						<div class="badge badge-ghost badge-sm ml-2">
							<div class="bg-success w-2 h-2 rounded-full"></div>
							Läuft
						</div>
					{/if}
				</div>

				{#if event.attendanceMode === 'online'}
					<div class="flex items-center gap-1.5 text-sm">
						<i class="icon-[ph--globe] size-4 min-w-4"></i>
						<span class="leading-tight">Online</span>
					</div>
				{:else if event.address?.length}
					<div class="flex items-center gap-1.5 text-sm">
						<div class="flex items-center gap-1">
							{#if event.attendanceMode === 'offline+online'}
								<i class="icon-[ph--globe] size-4 min-w-4"></i>
							{/if}
							<i class="icon-[ph--map-pin] size-4 min-w-4"></i>
						</div>

						<div class="leading-tight">
							{#if event.distanceKm}
								<span class="font-medium">
									{event.distanceKm} km entfernt
								</span>
							{/if}
							<div title={event.address?.join(', ')} class="truncate-2lines">
								{formatAddress(event.address)}
							</div>
						</div>
					</div>
				{/if}

				{#if tags.length}
					<div class="mt-1 flex flex-wrap gap-1 text-xs">
						{#each tags as tag}
							<button class="badge badge-sm badge-ghost">
								{tag}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</article>
	</a>
{/if}