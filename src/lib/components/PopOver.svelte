<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { Snippet } from 'svelte';

	type Props = {
		trigger: Snippet;
		content: Snippet;
		contentClass?: string;
	};

	const { trigger, content, contentClass }: Props = $props();
</script>

<Popover.Root>
	<Popover.Trigger>
		{@render trigger()}
	</Popover.Trigger>
	<Popover.Content class={['card card-border shadow-lg', contentClass]}>
		<Popover.Close />
		<Popover.Arrow />
		{@render content()}
	</Popover.Content>
</Popover.Root>

<style>
	:global([data-bits-floating-content-wrapper]) {
		min-width: auto !important;
	}
</style>
