<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { Snippet } from 'svelte';

	type Props = {
		trigger: Snippet;
		content: Snippet;
		contentClass?: string;
		contentProps?: Popover.ContentProps;
		triggerClass?: string;
	};

	const { trigger, content, contentClass, contentProps, triggerClass }: Props = $props();
</script>

<Popover.Root>
	<Popover.Trigger class={triggerClass}>
		{@render trigger()}
	</Popover.Trigger>
	<Popover.Content {...contentProps} class={['card card-border shadow-lg', contentClass]}>
		{@render content()}
		<Popover.Close />
		<Popover.Arrow />
	</Popover.Content>
</Popover.Root>

<style>
	:global([data-bits-floating-content-wrapper]) {
		min-width: auto !important;
	}
</style>
