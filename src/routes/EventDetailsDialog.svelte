<script lang="ts">
	import type { UiEvent } from './+page.server';
	import { Dialog } from 'bits-ui';
	import X from '~icons/ph/x';
	import EventDetails from './EventDetails.svelte';
	import { page } from '$app/state';
	import { ArrowLeft } from 'phosphor-svelte';
	import { onTap } from '$lib/attachments';

	let { event: eventParam }: { event: UiEvent | undefined } = $props();
	let event = $state<UiEvent | undefined>(eventParam);

	$effect(() => {
		// we keep the event cuz its needed for the dialog closing animation. Content would be immeadiately gone otherwise and animation looks weird.
		if (eventParam) {
			event = eventParam;
		}
	});
</script>

<Dialog.Root
	open={page.state.selectedEventId !== undefined}
	onOpenChange={(e) => {
		if (e.valueOf() === false) {
			window.history.back();
		}
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay
			class={[
				'fixed inset-0 z-50 bg-stone-800/90 transition-opacity',
				'data-[state=open]:animate-in',
				'data-[state=open]:ease-out',
				'data-[state=open]:fade-in',
				'data-[state=open]:duration-300',
				'data-[state=closed]:animate-out',
				'data-[state=closed]:ease-in',
				'data-[state=closed]:fade-out',
				'data-[state=closed]:duration-150'
			]}
		/>

		<Dialog.Content
			role="dialog"
			class={[
				'bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl',
				'data-[state=open]:animate-in',
				'data-[state=open]:ease-out',
				'data-[state=open]:fade-in',
				'data-[state=open]:slide-in-from-top-4',
				'data-[state=open]:sm:zoom-in-95',
				'data-[state=open]:duration-300',
				'data-[state=closed]:animate-out',
				'data-[state=closed]:ease-in',
				'data-[state=closed]:fade-out',
				'data-[state=closed]:slide-out-to-top-4',
				'data-[state=closed]:sm:zoom-out-95',
				'data-[state=closed]:duration-150'
			]}
			style="scrollbar-width: thin;"
		>
			<div class="sticky top-2 right-2 z-20 ml-auto h-0 w-max">
				<button {@attach onTap(() => window.history.back())} class="btn btn-circle shadow-lg">
					<X class="size-5"></X>
				</button>
			</div>

			{#if event}
				<EventDetails {event} />
			{/if}

			<div class="flex w-full justify-center gap-6 pb-6">
				<button {@attach onTap(() => window.history.back())} class="btn btn-sm">
					<ArrowLeft class="mr-1 size-5" />
					Zurück zur Übersicht
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
