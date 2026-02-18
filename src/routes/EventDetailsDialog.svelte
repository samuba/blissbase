<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { Dialog } from '$lib/components/dialog';
	import EventDetails from './EventDetails.svelte';
	import { page } from '$app/state';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from '$lib/common';

	let { event: eventParam }: { event: UiEvent | undefined } = $props();
	let event = $state<UiEvent | undefined>(eventParam);
	let isHandlingClose = $state(false);

	// Derive open state from page state
	const isOpen = $derived(page.state.selectedEventId !== undefined);

	$effect(() => {
		// Keep the event for smooth content display
		if (eventParam) {
			event = eventParam;
		}
	});

	function handleClose() {
		if (isHandlingClose) return;
		isHandlingClose = true;
		window.history.back();
		isHandlingClose = false;
	}
</script>

<Dialog.Root
	open={isOpen}
	onOpenChange={(shouldOpen) => {
		// Intercept close attempts - we handle the animation ourselves
		if (!shouldOpen && isOpen && !isHandlingClose) {
			handleClose();
		}
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class={['fixed inset-0 z-50 bg-stone-800/90 transition-opacity', dialogOverlayAnimationClasses]} />

		<Dialog.Content
			role="dialog"
			class={[
				'bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl',
				dialogContentAnimationClasses
			]}
			style="scrollbar-width: thin"
			onOpenAutoFocus={(e) => {
				e.preventDefault(); // ugly blue focus on close button in safari otherwise
			}}
			onInteractOutside={(e) => {
				e.preventDefault();
				handleClose();
			}}
			onEscapeKeydown={(e) => {
				e.preventDefault();
				handleClose();
			}}
		>
			<div class="sticky top-0 right-0 z-20 ml-auto h-0 w-max">
				<button onclick={handleClose} class="rounded-full p-4" aria-label="Schließen">
					<div class="btn btn-circle btn-primary shadow-lg drop-shadow-2xl">
						<i class="icon-[ph--x] size-5"></i>
					</div>
				</button>
			</div>

			{#if event}
				<EventDetails
					{event}
					onShowEventForTag={(tag) => {
						eventsStore.handleSearchTermChange(tag);
						handleClose();
					}}
				/>
			{/if}

			<div class="flex w-full justify-center gap-6 pb-6">
				<button onclick={handleClose} class="btn btn-sm">
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück zur Übersicht
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
