<script lang="ts">
	import { Dialog } from 'bits-ui';
	import OverlayAnimated from './DialogOverlayAnimated.svelte';
	import ContentAnimated from './DialogContentAnimated.svelte';
	import type { Snippet } from 'svelte';

	let {
		open,
		onClose,
		children
	}: {
		open: boolean;
		onClose: () => void;
		children: Snippet;
	} = $props();

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) onClose();
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Portal>
		<OverlayAnimated />

		<ContentAnimated
			role="dialog"
			data-testid="details-dialog"
			class="bg-base-100 sm:rounded-box [scrollbar-width:thin] fixed top-[50%] left-[50%] z-60 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
			}}
		>
			<div class="sticky top-0 right-0 z-20 ml-auto h-0 w-max">
				<Dialog.Close type="button" class="block rounded-full p-4" aria-label="Schließen" data-testid="dialog-close">
					<div class="btn btn-circle btn-primary shadow-lg drop-shadow-2xl">
						<i class="icon-[ph--x] size-5"></i>
					</div>
				</Dialog.Close>
			</div>

			{@render children()}

			<div class="mt-2 flex w-full justify-center gap-6 pb-6 md:hidden">
				<Dialog.Close type="button" class="btn btn-sm">
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück
				</Dialog.Close>
			</div>
		</ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
