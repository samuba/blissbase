<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { formatAddress, formatTimeStr } from '$lib/common';
	import { pushState } from '$app/navigation';
	import { routes } from '$lib/routes';
	import RandomPlaceholderImg from './RandomPlaceholderImg.svelte';

	const { event, class: className }: { event: UiEvent; class?: string } = $props();

	let imageLoadError = $state(false);
	const imageUrl = $derived(
		imageLoadError
			? (event.imageUrls?.[0]?.split('https:')?.[2] ?? '')
			: (event.imageUrls?.[0] ?? '')
	);
</script>

<a
	href={routes.eventDetails(event.slug)}
	class="w-full"
	data-sveltekit-preload-data="false"
	onclick={(e) => {
		e.preventDefault();
		pushState(routes.eventDetails(event.slug), { selectedEventId: event.id });
	}}
>
	<div
		class="card bg-base-100 flex flex-col rounded-lg shadow-sm transition-all hover:scale-105 hover:shadow-lg sm:flex-row {className}"
	>
		<div
			class={[
				'from-base-200/50 to-base-300 relative min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-l-lg sm:rounded-tr-none'
			]}
		>
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

		<div class="card-body flex flex-col gap-2">
			<h3 class="card-title leading-snug tracking-tight">
				{event.name}

				{#if event.soldOut}
					<span class="badge badge-sm badge-ghost ml-1">Ausgebucht</span>
				{/if}
			</h3>

			<div class="flex items-center gap-1">
				<!-- <i class="icon-[ph--clock] mr-1.5 size-4 min-w-4"></i> -->
				{formatTimeStr(event.startAt, event.endAt)}
			</div>

			{#if event.address?.length}
				<div class="flex items-center gap-1 text-sm">
					<i class="icon-[ph--map-pin] mr-1.5 size-4 min-w-4"></i>

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

			{#if (event.tags?.length ?? 0) > 0}
				<div class="mt-1 flex flex-wrap gap-1 text-xs">
					{#each event.tags! as tag}
						<button class="badge badge-sm badge-ghost">
							{tag?.de ?? tag}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</a>
