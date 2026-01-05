<script lang="ts">
	import { Dialog, type WithoutChildrenOrChild } from 'bits-ui';
	import { fade } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	let {
		ref = $bindable(null),
		inDuration = 200,
		outDuration = 100,
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<Dialog.OverlayProps> & {
		inDuration?: number;
		outDuration?: number;
		class?: ClassValue;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Overlay forceMount bind:ref {...restProps}>
	{#snippet child({ props, open })}
		{#if open}
			<div
				{...props}
				class={['fixed inset-0 z-50 backdrop-blur-sm bg-stone-800/65', className]}
				in:fade={{ duration: inDuration }}
				out:fade={{ duration: outDuration }}
			>
				{@render children?.()}
			</div>
		{/if}
	{/snippet}
</Dialog.Overlay>

