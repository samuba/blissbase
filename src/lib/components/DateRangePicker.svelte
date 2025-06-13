<script lang="ts" module>
	import { type DateRangePickerRootPropsWithoutHTML, type DateRange } from 'bits-ui';
	export type DateRangePickerOnChange = DateRangePickerRootPropsWithoutHTML['onValueChange'];
</script>

<script lang="ts">
	import { DateRangePicker } from 'bits-ui';
	import {
		CalendarDate,
		endOfMonth,
		startOfWeek,
		endOfWeek,
		type DateValue
	} from '@internationalized/date';

	const today = new CalendarDate(
		new Date().getFullYear(),
		new Date().getMonth() + 1,
		new Date().getDate()
	);

	type DateRangePickerProps = {
		value?: { start: CalendarDate; end: CalendarDate };
		class?: string;
		onChange: DateRangePickerOnChange;
	};

	let {
		value = $bindable({
			start: today,
			end: endOfMonth(today.add({ months: 6 }))
		}),
		class: className,
		onChange
	}: DateRangePickerProps = $props();

	let isOpen = $state(false);
	let previousStart = $state(value?.start as DateValue);
	let previousEnd = $state(value?.end as DateValue);

	function internalOnChange(newValue: DateRange) {
		// only trigger if the value has actuallychanged
		if (!newValue.start || !newValue.end) return;
		if (
			previousStart.toString() === newValue.start.toString() &&
			previousEnd.toString() === newValue.end.toString()
		) {
			return;
		}

		previousStart = newValue.start;
		previousEnd = newValue.end;
		onChange?.(newValue);
	}

	function setDateRange(start: CalendarDate, end: CalendarDate) {
		value = { start, end };
		internalOnChange({ start, end });
		isOpen = false;
	}

	function getThisWeek() {
		const start = startOfWeek(today, 'de-DE');
		const end = endOfWeek(today, 'de-DE');
		setDateRange(start, end);
	}

	function getThisWeekend() {
		const start = startOfWeek(today, 'de-DE').add({ days: 5 }); // Friday
		const end = endOfWeek(today, 'de-DE'); // Sunday
		setDateRange(start, end);
	}

	function getNextWeek() {
		const start = startOfWeek(today, 'de-DE').add({ days: 7 });
		const end = endOfWeek(today, 'de-DE').add({ days: 7 });
		setDateRange(start, end);
	}

	function getThisMonth() {
		const start = new CalendarDate(today.year, today.month, 1);
		const end = endOfMonth(today);
		setDateRange(start, end);
	}
</script>

<DateRangePicker.Root
	weekdayFormat="short"
	fixedWeeks={true}
	class="flex w-fit flex-col gap-1.5"
	bind:value
	bind:open={isOpen}
	locale="de-DE"
	onValueChange={internalOnChange}
>
	<DateRangePicker.Trigger class="w-fit">
		<div
			class="h-input input focus-within:border-neutral focus-within:shadow-date-field-focus px-3.5 select-none {className}"
		>
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

			<i class="icon-[ph--calendar-dots] size-6"></i>
		</div>
	</DateRangePicker.Trigger>
	<DateRangePicker.Content sideOffset={6} class="z-50">
		<DateRangePicker.Calendar class="card card-border rounded-15px bg-base-100 p-4 shadow-xl">
			{#snippet children({ months, weekdays })}
				<div class="grid grid-cols-2 gap-2 pb-2">
					<button class="btn btn-sm px-0" onclick={getThisWeek}> Diese Woche </button>
					<button class="btn btn-sm px-0" onclick={getThisWeekend}> Dieses Wochenende </button>
					<button class="btn btn-sm px-0" onclick={getNextWeek}> Nächste Woche </button>
					<button class="btn btn-sm px-0" onclick={getThisMonth}> Diesen Monat </button>
				</div>

				<DateRangePicker.Header class="flex items-center justify-between">
					<DateRangePicker.PrevButton class="btn btn-ghost p-1.5 active:scale-[0.98]">
						<i class="icon-[ph--caret-left] size-6"></i>
					</DateRangePicker.PrevButton>
					<DateRangePicker.Heading class="text-base-content text-lg font-medium" />
					<DateRangePicker.NextButton class="btn btn-ghost p-1.5 active:scale-[0.98]">
						<i class="icon-[ph--caret-right] size-6"></i>
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
													class={'rounded-9px text-base-content hover:border-primary focus-visible:ring-primary! data-highlighted:bg-base-300 data-selected:bg-base-300 data-selection-end:bg-primary data-selection-start:bg-primary data-disabled:text-base-content/30 data-selected:text-primary-content data-selection-end:text-primary-content data-selection-start:text-primary-content data-unavailable:text-base-content/50 data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:border-primary group relative inline-flex size-10  items-center justify-center overflow-visible border border-transparent bg-transparent p-0 text-sm font-normal whitespace-nowrap transition-all data-disabled:pointer-events-none data-highlighted:rounded-none data-outside-month:pointer-events-none data-selected:font-medium data-selection-end:rounded-r-3xl data-selection-end:font-medium data-selection-start:rounded-l-3xl data-selection-start:font-medium data-selection-start:focus-visible:ring-2 data-selection-start:focus-visible:ring-offset-2! data-unavailable:line-through data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:rounded-none data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:ring-0! data-selected:[&:not([data-selection-start])]:[&:not([data-selection-end])]:focus-visible:ring-offset-0!'}
												>
													<div
														class="bg-primary-content absolute top-[5px] hidden size-1 rounded-full transition-all group-data-today:block"
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
