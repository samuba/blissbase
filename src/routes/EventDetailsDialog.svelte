<script lang="ts" module>
	let event = $state<UiEvent | undefined>(undefined);

	export function showEventDetailsDialog(eventToShow: UiEvent) {
		event = eventToShow;
	}
</script>

<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { Dialog } from '$lib/components/dialog';
	import EventDetails from './EventDetails.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from '$lib/common';
	import { browser } from '$app/environment';

	/**
	 * Pops the shallow `pushState` entry so the list view is restored (browser back / swipe back).
	 */
	function handleClose() {
		if (!browser) return;
		event = undefined;
		history.back();
	}

	function onOpenChange(shouldOpen: boolean) {
		if (shouldOpen) return;
		handleClose();
	}
</script>

<Dialog.Root open={!!event} onOpenChange={onOpenChange}>
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
		>
			<div class="sticky top-0 right-0 z-20 ml-auto h-0 w-max">
				<Dialog.Close  class="rounded-full p-4 block" aria-label="Schließen">
					<div class="btn btn-circle btn-primary shadow-lg drop-shadow-2xl">
						<i class="icon-[ph--x] size-5"></i>
					</div>
				</Dialog.Close>
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

			<div class="md:hidden flex w-full justify-center gap-6 pb-6">
				<button type="button" class="btn btn-sm" onclick={handleClose}>
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück zur Übersicht
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
