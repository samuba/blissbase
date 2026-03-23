<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { Snippet } from 'svelte';

	/** Bits UI trigger props (handlers, aria, ref) — spread onto your root trigger element. */
	type TriggerSnippetProps = { props: Record<string, unknown> };

	type Props = {
		trigger: Snippet<[TriggerSnippetProps]>;
		content: Snippet;
		contentClass?: string;
		contentProps?: Popover.ContentProps;
		triggerClass?: string;
		arrowProps?: Popover.ArrowProps;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	};

	let { trigger, content, contentClass, contentProps, triggerClass, open = $bindable(false), onOpenChange, arrowProps }: Props = $props();
</script>

<Popover.Root bind:open={open} onOpenChange={onOpenChange}>
	<Popover.Trigger class={triggerClass}>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
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
		<Popover.Arrow {...arrowProps} />
	</Popover.Content>
</Popover.Root>

<style>
	:global([data-bits-floating-content-wrapper]) {
		min-width: auto !important;
	}
</style>
