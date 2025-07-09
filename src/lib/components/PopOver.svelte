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
	<Popover.Content
		{...contentProps}
		class={[
			'card card-border z-10 shadow-lg',
			'data-[state=open]:animate-in',
			'data-[state=open]:ease-out',
			'data-[state=open]:fade-in',
			'data-[state=open]:duration-200',
			'data-[state=closed]:animate-out',
			'data-[state=closed]:ease-in',
			'data-[state=closed]:fade-out',
			'data-[state=closed]:duration-150',
			contentClass,
			contentProps?.class
		]}
	>
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
