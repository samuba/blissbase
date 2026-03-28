<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { Dialog } from '$lib/components/dialog';
	import EventDetails from './EventDetails.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from '$lib/common';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';

	let { events }: { events: UiEvent[] } = $props();
	let isHandlingClose = $state(false);

	/**
	 * Validates shallow state so visible close links stay same-origin paths only.
	 * @example getSafeEventListOrigin('/profile/favorites') // '/profile/favorites'
	 */
	function getSafeEventListOrigin(raw: unknown): string | undefined {
		if (typeof raw !== `string`) return undefined;
		const t = raw.trim();
		if (!t.startsWith(`/`) || t.startsWith(`//`)) return undefined;
		return t;
	}

	/**
	 * Resolves the visible event from the current shallow page state.
	 * @example getEventFromState({ selectedEventId: 12, events })
	 */
	function getEventFromState(selectedEventId: number | undefined, events: UiEvent[]): UiEvent | undefined {
		if (!selectedEventId) return undefined;
		return events.find((x) => x.id === selectedEventId);
	}
	const event = $derived(getEventFromState(page.state.selectedEventId, events));
	const isOpen = $derived(!!event);
	const originPath = $derived(getSafeEventListOrigin(page.state.eventListOrigin) ?? routes.root());

	/**
	 * Replaces the current history entry with the list origin URL while clearing the selected event.
	 * @example handleClose() // dialog close / overlay / escape
	 */
	function handleClose() {
		if (isHandlingClose) return;
		isHandlingClose = true;
		replaceState(resolve(originPath as InternalPathname), {
			...page.state,
			selectedEventId: undefined
		});
		queueMicrotask(() => {
			isHandlingClose = false;
		});
	}

	/** Satisfies typed `resolve()` while keeping runtime validation in {@link getSafeEventListOrigin}. */
	type InternalPathname = `/${string}`;
</script>

<Dialog.Root
	open={isOpen}
	onOpenChange={(shouldOpen) => {
		// Intercept close attempts - we handle the animation ourselves
		if (!shouldOpen && isOpen) {
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
				<a
					href={resolve(originPath as InternalPathname)}
					class="rounded-full p-4 block"
					aria-label="Schließen"
				>
					<div class="btn btn-circle btn-primary shadow-lg drop-shadow-2xl">
						<i class="icon-[ph--x] size-5"></i>
					</div>
				</a>
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
				<a href={resolve(originPath as InternalPathname)} class="btn btn-sm">
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück zur Übersicht
				</a>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
