<script lang="ts">
	import { Select, type WithoutChildren } from 'bits-ui';

	type SelectItem = {
		iconClass?: string;
		value: string;
		label: string;
		disabled?: boolean;
	};

	type Props = WithoutChildren<Select.RootProps> & {
		placeholder?: string;
		items: SelectItem[];
		contentProps?: WithoutChildren<Select.ContentProps>;
		triggerProps?: WithoutChildren<Select.TriggerProps>;
		hideTriggerText?: boolean;
	};

	let {
		value = $bindable(),
		items,
		contentProps,
		placeholder,
		triggerProps,
		hideTriggerText = false,
		...restProps
	}: Props = $props();

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label);
	const selectedIcon = $derived(
		(items.find((item) => item.value === value) as SelectItem)?.iconClass
	);
</script>

<Select.Root bind:value={value as never} {...restProps}>
	<Select.Trigger {...triggerProps}>
		<i class={[selectedIcon, 'size-5']}></i>
		<span class={[hideTriggerText && 'hidden', !hideTriggerText && 'sm:inline-block']}>
			{selectedLabel ? selectedLabel : placeholder}
		</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			{...contentProps}
			class={['bg-base-100 z-10 rounded-lg p-1 shadow-lg', contentProps?.class]}
		>
			<Select.ScrollUpButton>up</Select.ScrollUpButton>
			<Select.Viewport class="flex flex-col ">
				{#each items as { value, label, disabled, iconClass } (value)}
					<Select.Item
						{value}
						{label}
						{disabled}
						class={'hover:not-data-disabled:bg-base-200 flex cursor-default items-center gap-1 rounded-lg px-2 py-1 data-disabled:opacity-55'}
					>
						{#snippet children({ selected })}
							{#if iconClass}
								<i class={[iconClass, 'size-5']}></i>
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
