<script lang="ts">
	import type { ScrapedEvent } from '../../types'; // Corrected relative path
	import PersonIcon from 'phosphor-svelte/lib/UserCircle';
	const { event } = $props<{ event: ScrapedEvent }>();

	function areSameDay(date1: Date, date2: Date): boolean {
		return (
			date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate()
		);
	}

	const startDate = event.startAt ? new Date(event.startAt) : null;
	let endDate = event.endAt ? new Date(event.endAt) : null;
	let displayEndDate = endDate; // Date object to use for display
	let endDateOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }; // Default options

	if (startDate && endDate) {
		// Check if end date is midnight (00:00:00.000)
		const isMidnight =
			endDate.getHours() === 0 &&
			endDate.getMinutes() === 0 &&
			endDate.getSeconds() === 0 &&
			endDate.getMilliseconds() === 0;

		if (isMidnight) {
			// Create a date for the day before the original end date
			const dayBeforeEndDate = new Date(endDate);
			dayBeforeEndDate.setDate(endDate.getDate() - 1);

			// If the start date is the same day as the day before the end date
			if (areSameDay(startDate, dayBeforeEndDate)) {
				// Adjust display date to 23:59:59 on the start date
				displayEndDate = new Date(startDate);
				displayEndDate.setHours(23, 59, 59, 999);
				endDateOptions = { timeStyle: 'short' }; // Show only time
			} else if (areSameDay(startDate, endDate)) {
				// Original logic: If start and end are same day (even if midnight), show time only
				// This case might be redundant if midnight is handled above, but kept for clarity
				endDateOptions = { timeStyle: 'short' };
			}
		} else if (areSameDay(startDate, endDate)) {
			// Original logic: If start and end are same day (and not midnight), show time only
			endDateOptions = { timeStyle: 'short' };
		}
		// Otherwise, the default options (date + time) are used
	}
</script>

<a
	href={event.permalink}
	target="_blank"
	rel="noopener noreferrer"
	class="block overflow-hidden rounded-lg bg-white shadow-md transition-shadow duration-300 hover:shadow-lg"
>
	{#if event.imageUrls && event.imageUrls.length > 0}
		<img src={event.imageUrls[0]} alt={event.name} class="h-48 w-full object-cover" />
	{:else}
		<div class="h-48 w-full bg-gradient-to-br from-fuchsia-300 to-fuchsia-700"></div>
	{/if}
	<div class="p-4">
		<h2 class="mb-2 truncate text-xl font-semibold" title={event.name}>{event.name}</h2>
		{#if event.startAt}
			<p class="mb-1 text-sm text-gray-600">
				<time datetime={event.startAt}>
					{new Date(event.startAt).toLocaleString('de-DE', {
						dateStyle: 'medium',
						timeStyle: 'short'
					})}
				</time>
				{#if event.endAt && displayEndDate}
					-
					<time datetime={event.endAt}>
						{displayEndDate.toLocaleString('de-DE', endDateOptions)}
					</time>
				{/if}
			</p>
		{/if}
		{#if event.address && event.address.length > 0}
			<p class="mb-2 truncate text-sm text-gray-500">{event.address.join(', ')}</p>
		{/if}
		<div class="mt-4 flex items-center justify-between">
			{#if event.price}
				<span class="text-base text-gray-700">{event.price}</span>
			{:else}
				<span class="text-base text-gray-700">Free</span>
			{/if}
			<!-- View Event link removed -->
		</div>
		{#if event.host}
			<p class="mt-2 flex items-center text-xs text-gray-500">
				<PersonIcon class="mr-1 h-4 w-4 " />
				{#if event.hostLink}
					<a
						href={event.hostLink}
						target="_blank"
						rel="noopener noreferrer"
						class="hover:underline"
						on:click|stopPropagation>{event.host}</a
					>
				{:else}
					<span>{event.host}</span>
				{/if}
			</p>
		{/if}
	</div>
</a>
