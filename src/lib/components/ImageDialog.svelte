<script lang="ts">
	import { Dialog, type DialogTriggerProps } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		imageUrl,
		alt,
		children,
		triggerProps
	}: { imageUrl: string; alt: string; children: Snippet; triggerProps?: DialogTriggerProps } =
		$props();

	let open = $state(false);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger {...triggerProps}>
		{@render children()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/95" />
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center outline-none"
			onclick={() => (open = false)}
		>
			<img src={imageUrl} {alt} class="max-h-full max-w-full object-contain" />
			<Dialog.Close class="btn btn-circle absolute top-4 right-4 shadow-lg">
				<i class="icon-[ph--x] size-5"></i>
				<span class="sr-only">Close</span>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
