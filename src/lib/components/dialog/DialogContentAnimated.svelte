<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { fly } from 'svelte/transition';

	let {
		ref = $bindable(null),
		inDuration = 250,
		outDuration = 100,
		...restProps
	}: Dialog.ContentProps & {
		inDuration?: number;
		outDuration?: number;
	} = $props();
</script>

<Dialog.Content forceMount bind:ref>
	{#snippet child({ props, open })}
		{#if open}
			<div
				{...props}
				{...restProps}
				in:fly={{ y: 50, duration: inDuration }}
				out:fly={{ y: 50, duration: outDuration }}
			>
				{@render restProps.children?.()}
			</div>
		{/if}
	{/snippet}
</Dialog.Content>

