<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { formatAddress, formatTimeStr } from '$lib/common';
	import { pushState } from '$app/navigation';
	import { routes } from '$lib/routes';
	import RandomPlaceholderImg from './RandomPlaceholderImg.svelte';
	import { page } from '$app/state';
	import { flushSync } from 'svelte';
	import LoginDialog from './LoginDialog.svelte';
	import FavoriteButton from './FavoriteButton.svelte';

	const { event, class: className }: { event: UiEvent; class?: string } = $props();

	let imageLoadError = $state(false);
	const imageUrl = $derived(event.imageUrls?.[0]);
	const isSelected = $derived(page.state.selectedEventId === event.id);

	// Apply view-transition-name when hovering but NOT when selected (dialog will have it then)
	// EXCEPT during closing transition where we need it back
	let isHovering = $state(false);
	let isClosing = $state(false);
	let isOpening = $state(false);

	const shouldHaveTransitionName = $derived.by(() => {
		if (typeof window === 'undefined') return false;
		// Apply when:
		// 1. Hovering AND not selected (for opening - card -> dialog)
		// 2. isClosing is true (for closing - dialog -> card)
		// 3. isOpening is true (during opening transition - card -> dialog)
		return (isHovering && !isSelected) || isClosing || isOpening;
	});

	// Listen for prepare-close-transition event from dialog
	$effect(() => {
		if (typeof window === 'undefined') return;

		const handlePrepareClose = (e: CustomEvent) => {
			if (e.detail.eventId === event.id) {
				isClosing = true;
			}
		};

		const handleTransitionFinished = (e: CustomEvent) => {
			if (e.detail.eventId === event.id) {
				isClosing = false;
			}
		};

		document.addEventListener('prepare-close-transition', handlePrepareClose as EventListener);
		document.addEventListener('close-transition-finished', handleTransitionFinished as EventListener);

		return () => {
			document.removeEventListener('prepare-close-transition', handlePrepareClose as EventListener);
			document.removeEventListener('close-transition-finished', handleTransitionFinished as EventListener);
		};
	});

	async function handleClick(e: MouseEvent) {
		e.preventDefault();

		if (document.startViewTransition) {
			// Ensure hover state is set for the transition
			if (!isHovering) {
				isHovering = true;
				// Wait for the style to apply
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}

			// Mark that we're opening to keep the transition name during the transition
			isOpening = true;
			
			const transition = document.startViewTransition(() => {
				// Remove the transition name from card before updating state
				// so only the dialog will have it in the NEW state
				isOpening = false;
				
				flushSync(() => {
					pushState(routes.eventDetails(event.slug), { selectedEventId: event.id });
				});
			});

			// Clean up after transition
			transition.finished.finally(() => {
				isOpening = false;
			});
		} else {
			pushState(routes.eventDetails(event.slug), { selectedEventId: event.id });
		}
	}

	const tags  = $derived.by(() => {
		const tags = new Set<string>();
		event.tags2?.filter((x) => x.locale === 'de')?.forEach(x => tags.add(x.name));
		event.tags?.forEach(x => {
			if (x.de) tags.add(x.de);
			else tags.add(x);
		});
		return Array.from(tags);
	});

	let showLoginDialog = $state(false);
</script>

<LoginDialog bind:open={showLoginDialog} />

<a
	href={routes.eventDetails(event.slug)}
	class=" w-full"
	data-sveltekit-preload-data="false"
	onclick={handleClick}
	onmouseenter={() => (isHovering = true)}
	onmouseleave={() => (isHovering = false)}
>
	<article
		class="card bg-base-100 flex flex-col rounded-lg shadow-sm transition-all sm:flex-row {className}"
		style={shouldHaveTransitionName ? `view-transition-name: event-card-${event.id}` : ''}
		data-event-id={event.id}
	>
		<div
			class={[
				'from-base-200/50 to-base-300 relative min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-l-lg sm:rounded-tr-none'
			]}
		>
		<FavoriteButton 
			eventId={event.id}
			class="absolute bottom-2 right-2 z-5"
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


			{#if event.attendanceMode === 'online'}
				<div class="flex items-center gap-1.5 text-sm">
					<i class="icon-[ph--globe] size-4 min-w-4"></i>
					<span class="leading-tight">Online</span>
				</div>
			{:else}
				{#if event.address?.length}
					<div class="flex items-center gap-1.5 text-sm">
						<div class="flex items-center gap-1">
							<i class="icon-[ph--map-pin] size-4 min-w-4"></i>
							{#if event.attendanceMode === 'offline+online'}
								<i class="icon-[ph--globe] size-4 min-w-4"></i>
							{/if}
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
			{/if}


			{#if (tags.length)}
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
