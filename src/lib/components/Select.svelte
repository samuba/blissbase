<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import { Select as BitsSelect, type WithoutChildren } from 'bits-ui';

	let {
		value = $bindable(),
		options,
		placeholder,
		contentProps,
		triggerProps,
		remoteFunctionField,
		...restProps
	}: Props = $props();

	const selectedOption = $derived(options.find((option) => option.value === value));

	/**
	 * Creates a plain-text label from option HTML for typeahead and accessibility.
	 *
	 * @example
	 * getOptionLabel({ option: { value: `email`, html: `<i></i><span>Email</span>` } }) // `Email`
	 */
	function getOptionLabel(args: { option: SelectOption }) {
		const label = args.option.html.replace(/<[^>]*>/g, ` `).replace(/\s+/g, ` `).trim();
		if (label) return label;
		return args.option.value;
	}

	type SingleRootProps = Extract<WithoutChildren<BitsSelect.RootProps>, { type: `single` }>;

	type Props = Omit<SingleRootProps, `children` | `type` | `value`> & {
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		contentProps?: WithoutChildren<BitsSelect.ContentProps>;
		triggerProps?: WithoutChildren<BitsSelect.TriggerProps>;
		remoteFunctionField?: RemoteFormField<SelectOption['value']>;
	};

	type SelectOption = {
		value: string;
		html: string;
		disabled?: boolean;
	};
</script>

<BitsSelect.Root bind:value type="single" {...restProps}>
	<BitsSelect.Trigger {...triggerProps} class={[`btn justify-start gap-2`, triggerProps?.class]} >
		{#if selectedOption}
			{@html selectedOption.html}
		{:else if placeholder}
			{placeholder}
		{/if}
		<i class="icon-[ph--caret-down] size-5"></i>
	</BitsSelect.Trigger>
	<BitsSelect.Portal>
		<BitsSelect.Content
			{...contentProps}
			class={[`focus-override card card-border bg-base-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--bits-select-content-available-height) min-w-(--bits-select-anchor-width) rounded-xl px-1 py-1 shadow-xl outline-hidden select-none data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1`, contentProps?.class]}
			sideOffset={10}
		>
			<BitsSelect.ScrollUpButton class="flex w-full items-center justify-center pt-1 pb-2">
				<i class="icon-[ph--caret-double-up] size-4"></i>
			</BitsSelect.ScrollUpButton>
			<BitsSelect.Viewport class="p-1">
				{#each options as option (option.value)}
					<BitsSelect.Item
						value={option.value}
						label={getOptionLabel({ option })}
						disabled={option.disabled}
						class="rounded-lg data-highlighted:bg-base-200 flex h-10 w-full items-center gap-2 py-5 pl-3 pr-5 text-sm outline-hidden select-none data-disabled:opacity-55 data-selected:font-bold"
					>
						{#snippet children({ selected })}
							{@html option.html}
							{#if selected}
								<i class="icon-[ph--check] ml-auto size-4"></i>
							{/if}
						{/snippet}
					</BitsSelect.Item>
				{/each}
			</BitsSelect.Viewport>
			<BitsSelect.ScrollDownButton class="flex w-full items-center justify-center pb-1 pt-2">
				<i class="icon-[ph--caret-double-down] size-4"></i>
			</BitsSelect.ScrollDownButton>
		</BitsSelect.Content>
	</BitsSelect.Portal>
</BitsSelect.Root>

<select class="hidden" {...remoteFunctionField?.as('select')} bind:value={value}>
	{#each options as option (option.value)}
		<option value={option.value}></option>
	{/each}
</select>
