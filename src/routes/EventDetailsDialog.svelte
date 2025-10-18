<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { Dialog } from 'bits-ui';
	import EventDetails from './EventDetails.svelte';
	import { page } from '$app/state';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { browser } from '$app/environment';
	import { flushSync } from 'svelte';

	let { event: eventParam }: { event: UiEvent | undefined } = $props();
	let event = $state<UiEvent | undefined>(eventParam);
	let isClosingTransition = $state(false);
	let isHandlingClose = $state(false);

	// Derive open state from page state
	const isOpen = $derived(page.state.selectedEventId !== undefined);

	$effect(() => {
		// we keep the event cuz its needed for the dialog closing animation. Content would be immeadiately gone otherwise and animation looks weird.
		if (eventParam) {
			event = eventParam;
		}
	});

	async function handleClose() {
		// Prevent multiple simultaneous close operations
		if (isHandlingClose) return;
		isHandlingClose = true;

		if (!browser) {
			window.history.back();
			isHandlingClose = false;
			return;
		}

		if (document.startViewTransition) {
			// Store the event ID for the transition name
			const closingEventId = page.state.selectedEventId;

			// Dispatch event to notify the specific card to prepare for closing transition
			const closeEvent = new CustomEvent('prepare-close-transition', {
				detail: { eventId: closingEventId },
				bubbles: true
			});
			document.dispatchEvent(closeEvent);

			// Wait for the card to apply view-transition-name using requestAnimationFrame
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			// Find the card element using data attribute
			const targetCardElement = document.querySelector(
				`[data-event-id="${closingEventId}"]`
			) as HTMLElement | null;

			// Remove the card's transition name temporarily so only dialog has it in OLD state
			if (targetCardElement) {
				// Store the original transition name to restore later
				const originalTransitionName = targetCardElement.style.viewTransitionName;
				targetCardElement.style.viewTransitionName = 'none';

				// Wait for style to apply
				await new Promise((resolve) => requestAnimationFrame(resolve));

				const transition = document.startViewTransition(() => {
					// Remove dialog's transition name
					isClosingTransition = true;

					// Update DOM
					flushSync(() => {
						window.history.back();
					});

					// Restore transition name to the card for NEW state
					if (targetCardElement && originalTransitionName) {
						targetCardElement.style.viewTransitionName = originalTransitionName;
					}
				});

				await transition.finished;
				isClosingTransition = false;

				// Clear the inline style so the card's reactive binding takes over again
				if (targetCardElement) {
					targetCardElement.style.viewTransitionName = '';
				}

				// Notify the card that transition is complete
				const finishedEvent = new CustomEvent('close-transition-finished', {
					detail: { eventId: closingEventId },
					bubbles: true
				});
				document.dispatchEvent(finishedEvent);
			} else {
				// Fallback if card not found
				window.history.back();
			}
		} else {
			window.history.back();
		}

		isHandlingClose = false;
	}

	// Build the style string for view transition
	const dialogStyle = $derived.by(() => {
		const styles = ['scrollbar-width: thin'];
		// Have view-transition-name when dialog is open, but NOT when closing
		// (during closing, the card has the name instead)
		if (page.state.selectedEventId && browser && !isClosingTransition) {
			styles.push(`view-transition-name: event-card-${page.state.selectedEventId}`);
		}
		return styles.join('; ');
	});
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
		<Dialog.Overlay class={['fixed inset-0 z-50 bg-stone-800/90 transition-opacity']} />

		<Dialog.Content
			role="dialog"
			class={[
				'bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl'
			]}
			style={dialogStyle}
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
