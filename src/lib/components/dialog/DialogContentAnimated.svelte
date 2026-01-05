<script lang="ts">
	import { Dialog, type WithoutChildrenOrChild } from 'bits-ui';
	import { fly } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		inDuration = 250,
		outDuration = 100,
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<Dialog.ContentProps> & 
		HTMLAttributes<HTMLDivElement> & {
		inDuration?: number;
		outDuration?: number;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Content forceMount bind:ref>
	{#snippet child({ props, open })}
		{#if open}
			<div
				{...props}
				{...restProps}
				class={className}
				in:fly={{ y: 50, duration: inDuration }}
				out:fly={{ y: 50, duration: outDuration }}
			>
				{@render children?.()}
			</div>
		{/if}
	{/snippet}
</Dialog.Content>

