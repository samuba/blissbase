<script lang="ts">
	import { Select, type WithoutChildren } from 'bits-ui';

	type Props = WithoutChildren<Select.RootProps> & {
		placeholder?: string;
		items: { value: string; label: string; disabled?: boolean; icon?: unknown }[];
		contentProps?: WithoutChildren<Select.ContentProps>;
		// any other specific component props if needed
	};

	let { value = $bindable(), items, contentProps, placeholder, ...restProps }: Props = $props();

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label);
	const selectedIcon = $derived(items.find((item) => item.value === value)?.icon);
</script>

<Select.Root bind:value={value as never} {...restProps}>
	<Select.Trigger class="select">
		{@html selectedIcon}
		{selectedLabel ? selectedLabel : placeholder}
	</Select.Trigger>
	<Select.Portal>
		<Select.Content {...contentProps} class="bg-base-100 rounded-lg p-1 shadow-lg">
			<Select.ScrollUpButton>up</Select.ScrollUpButton>
			<Select.Viewport class="flex flex-col ">
				{#each items as { value, label, disabled, icon } (value)}
					<Select.Item
						{value}
						{label}
						{disabled}
						class="hover:bg-base-200 flex cursor-default items-center gap-1 rounded-lg px-2 py-1"
					>
						{#snippet children({ selected })}
							{#if icon}
								{@html icon}
							{/if}
							<span class:font-semibold={selected}>
								{label}
							</span>
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
			<Select.ScrollDownButton>down</Select.ScrollDownButton>
		</Select.Content>
	</Select.Portal>
</Select.Root>
