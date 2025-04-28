<script lang="ts" module>
	import { type DateRangePickerRootPropsWithoutHTML } from 'bits-ui';
	export type DateRangePickerOnChange = DateRangePickerRootPropsWithoutHTML['onValueChange'];
</script>

<script lang="ts">
	import { DateRangePicker } from 'bits-ui';
	import Calendar from 'phosphor-svelte/lib/CalendarDots';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import { CalendarDate, endOfMonth } from '@internationalized/date';

	type DateRangePickerProps = {
		value?: { start: CalendarDate; end: CalendarDate };
		class?: string;
		onChange: DateRangePickerOnChange;
	};

	const today = new CalendarDate(
		new Date().getFullYear(),
		new Date().getMonth() + 1,
		new Date().getDate()
	);

	let {
		value = $bindable({
			start: today,
			end: endOfMonth(today.add({ months: 6 }))
		}),
		class: className,
		onChange
	}: DateRangePickerProps = $props();
</script>

<DateRangePicker.Root
	weekdayFormat="short"
	fixedWeeks={true}
	class="flex w-fit flex-col gap-1.5"
	bind:value
	locale="de-DE"
	onValueChange={onChange}
>
	<DateRangePicker.Trigger class="w-fit">
		<div
			class="h-input input border-base-300 bg-base-100 text-base-content focus-within:border-neutral focus-within:shadow-date-field-focus hover:border-neutral flex items-center border px-4 py-3 text-sm tracking-[0.01em] select-none {className}"
		>
			<Calendar class="size-6" />

			{#each ['start', 'end'] as const as type}
				<DateRangePicker.Input {type}>
					{#snippet children({ segments })}
						{#each segments as { part, value }}
							<div class="inline-block select-none">
								{#if part === 'literal'}
									<DateRangePicker.Segment {part} class="text-base-content/70 ">
										{value}
									</DateRangePicker.Segment>
								{:else}
									<DateRangePicker.Segment
										{part}
										class="hover:bg-base-200 focus:bg-base-200 focus:text-base-content aria-[valuetext=Empty]:text-base-content/50 rounded-[5px] focus-visible:ring-0! focus-visible:ring-offset-0!"
									>
										{value}
									</DateRangePicker.Segment>
								{/if}
							</div>
						{/each}
					{/snippet}
				</DateRangePicker.Input>
				{#if type === 'start'}
					<div aria-hidden="true" class="text-base-content/70 px-1">⁠–⁠⁠⁠⁠⁠</div>
				{/if}
			{/each}
		</div>
	</DateRangePicker.Trigger>
	<DateRangePicker.Content sideOffset={6} class="z-50">
		<DateRangePicker.Calendar
			class="rounded-15px border-base-300 bg-base-200 shadow-popover mt-6 border p-[22px]"
		>
			{#snippet children({ months, weekdays })}
				<DateRangePicker.Header class="flex items-center justify-between">
					<DateRangePicker.PrevButton
						class="rounded-9px bg-base-200 hover:bg-base-300 inline-flex size-10 items-center justify-center transition-all active:scale-[0.98]"
					>
						<CaretLeft class="size-6" />
					</DateRangePicker.PrevButton>
					<DateRangePicker.Heading class="text-base-content text-[15px] font-medium" />
					<DateRangePicker.NextButton
						class="rounded-9px bg-base-200 hover:bg-base-300 inline-flex size-10 items-center justify-center transition-all active:scale-[0.98]"
					>
						<CaretRight class="size-6" />
					</DateRangePicker.NextButton>
				</DateRangePicker.Header>
				<div class="flex flex-col space-y-4 pt-4 sm:flex-row sm:space-y-0 sm:space-x-4">
					{#each months as month}
						<DateRangePicker.Grid class="w-full border-collapse space-y-1 select-none">
							<DateRangePicker.GridHead>
								<DateRangePicker.GridRow class="mb-1 flex w-full justify-between">
									{#each weekdays as day}
										<DateRangePicker.HeadCell
											class="text-base-content/70 w-10 rounded-md text-xs font-normal!"
										>
											<div>{day.slice(0, 2)}</div>
										</DateRangePicker.HeadCell>
									{/each}
								</DateRangePicker.GridRow>
							</DateRangePicker.GridHead>
							<DateRangePicker.GridBody>
								{#each month.weeks as weekDates}
									<DateRangePicker.GridRow class="flex w-full">
										{#each weekDates as date}
											<DateRangePicker.Cell
												{date}
												month={month.value}
												class="relative m-0 size-10 overflow-visible p-0! text-center text-sm focus-within:relative focus-within:z-20"
											>
												<DateRangePicker.Day
													class={'rounded-9px text-base-content hover:border-primary focus-visible:ring-primary! data-selection-end:rounded-9px data-selection-start:rounded-9px data-highlighted:bg-base-300 data-selected:bg-base-300 data-selection-end:bg-primary data-selection-start:bg-primary data-disabled:text-base-content/30 data-selected:text-primary-content data-selection-end:text-primary-content data-selection-start:text-primary-content data-unavailable:text-base-content/50 data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:border-primary group relative  inline-flex size-10 items-center justify-center overflow-visible border border-transparent bg-transparent p-0 text-sm font-normal whitespace-nowrap transition-all data-disabled:pointer-events-none data-highlighted:rounded-none data-outside-month:pointer-events-none data-selected:font-medium data-selection-end:font-medium data-selection-start:font-medium data-selection-start:focus-visible:ring-2 data-selection-start:focus-visible:ring-offset-2! data-unavailable:line-through data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:rounded-none data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:ring-0! data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:ring-offset-0!'}
												>
													<div
														class="bg-primary group-data-selected:bg-base-100 absolute top-[5px] hidden size-1 rounded-full transition-all group-data-today:block"
													></div>
													{date.day}
												</DateRangePicker.Day>
											</DateRangePicker.Cell>
										{/each}
									</DateRangePicker.GridRow>
								{/each}
							</DateRangePicker.GridBody>
						</DateRangePicker.Grid>
					{/each}
				</div>
			{/snippet}
		</DateRangePicker.Calendar>
	</DateRangePicker.Content>
</DateRangePicker.Root>
