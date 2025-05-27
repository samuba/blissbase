<script lang="ts">
	import type { UiEvent } from '$lib/../routes/+page.server';
	import { formatAddress, formatTimeStr } from '$lib/common';
	import { pushState } from '$app/navigation';
	import { routes } from '$lib/routes';
	import { onTap } from '$lib/attachments';

	const { event, class: className }: { event: UiEvent; class?: string } = $props();

	let noImage = $state(event.imageUrls?.[0] === undefined);
</script>

<a
	href={`/${event.id}`}
	class="w-full"
	{@attach onTap((e) => {
		e.preventDefault();
		pushState(routes.eventDetails(event.id), { selectedEventId: event.id });
	})}
>
	<div
		class="card bg-base-100 flex flex-col rounded-lg shadow-sm transition-all hover:scale-105 hover:shadow-lg sm:flex-row {className}"
	>
		<div
			class={[
				'from-base-200/50 to-base-300 relative min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-l-lg sm:rounded-tr-none'
			]}
		>
			{#if noImage}{:else}
				<div
					class="h-full rounded-t-lg bg-cover bg-center"
					style="background-image: url({event.imageUrls?.[0]})"
				>
					<figure
						class="h-full rounded-t-lg backdrop-blur-md backdrop-brightness-85 sm:rounded-l-lg sm:rounded-tr-none"
					>
						<img
							src={event.imageUrls?.[0]}
							alt="illustration for event: {event.name}"
							class="h-full max-h-72 max-w-full object-cover"
							onerror={() => (noImage = true)}
						/>
					</figure>
				</div>
			{/if}
		</div>

		<div class="card-body flex flex-col gap-2">
			<h3 class="card-title leading-snug tracking-tight">{event.name}</h3>

			<time class="text-sm" title={event.startAt?.toLocaleString()}>
				{formatTimeStr(event.startAt, event.endAt)}
			</time>

			{#if event.address?.length}
				<div class="flex items-center gap-1 text-sm">
					<i class="icon-[ph--map-pin] mr-1.5 size-4 min-w-4"></i>

					<div class="leading-tight">
						{#if event.distanceKm}
							<span class="font-medium">
								{event.distanceKm} km entfernt
							</span>
						{/if}
						<div title={event.address?.join(', ')}>
							{formatAddress(event.address)}
						</div>
					</div>
				</div>
			{/if}

			{#if event.tags && event.tags.length}
				<div class="mt-1 flex flex-wrap gap-1 text-xs">
					{#each event.tags as tag}
						<span class="badge badge-sm badge-ghost">{tag}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</a>
