<script lang="ts">
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { eventCategories } from '$lib/eventCategories';
	import { ALLOWED_DISTANCE_VALUES } from '$lib/locationFilter';
	import type { AttendanceMode } from '$lib/server/schema';

	let { foundSomeResultsBefore }: { foundSomeResultsBefore: boolean } = $props();

	const selectedCategories = $derived(
		(eventsStore.pagination.categorySlugs ?? []).map((slug) => ({
			slug,
			label: eventCategories.find((category) => category.slug === slug)?.label ?? slug,
		})),
	);

	const dateLabel = $derived.by(() => {
		const { start, end } = eventsStore.dateFilter;
		if (!start && !end) return ``;
		const format = (value: string) =>
			new Date(value).toLocaleDateString(`de-DE`, { dateStyle: `medium` });
		if (start && end) return `${format(start)} – ${format(end)}`;
		if (start) return format(start);
		return format(end!);
	});

	const attendanceLabel = $derived(attendanceModeLabel(eventsStore.pagination.attendanceMode));
	const locationLabel = $derived(
		eventsStore.locationFilter.plzCity?.trim() || (eventsStore.hasLocationFilter ? `Standort` : ``),
	);
	const selectedDistance = $derived(eventsStore.pagination.distance ?? ``);

	const hasChips = $derived(
		Boolean(
			eventsStore.hasSearchFilter ||
				selectedCategories.length ||
				eventsStore.hasDateFilter ||
				eventsStore.hasAttendanceModeFilter,
		),
	);

	function removeCategory(slug: string) {
		eventsStore.handleCategoryChange(
			(eventsStore.pagination.categorySlugs ?? []).filter((selected) => selected !== slug),
		);
	}

	function onRadiusChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		eventsStore.handleDistanceChange(value || null);
	}

	function attendanceModeLabel(mode: AttendanceMode | null | undefined) {
		if (mode === `offline`) return `Vor Ort`;
		if (mode === `online`) return `Online`;
		if (mode === `offline+online`) return `Vor Ort + Online`;
		return ``;
	}
</script>

<div
	class="flex flex-col items-center justify-center gap-3 py-12"
	role="status"
	data-testid="events-no-results"
>
	<p class="text-center text-base-content/60">
		{#if foundSomeResultsBefore}
			Keine weiteren Events gefunden
		{:else}
			Keine Events gefunden
		{/if}
	</p>

	{#if hasChips}
		<div class="flex max-w-lg flex-wrap items-center justify-center gap-2">
			{#if eventsStore.hasSearchFilter}
				<button
					type="button"
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap tracking-tight sm:tracking-normal"
					data-testid="events-no-results-chip-search"
					aria-label="Entfernen"
					onclick={() => eventsStore.handleSearchTermChange(``)}
				>
					{eventsStore.searchFilter}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/if}

			{#each selectedCategories as category (category.slug)}
				<button
					type="button"
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap tracking-tight sm:tracking-normal"
					data-testid={`events-no-results-chip-category-${category.slug}`}
					aria-label="Entfernen"
					onclick={() => removeCategory(category.slug)}
				>
					{category.label}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/each}

			{#if eventsStore.hasDateFilter && dateLabel}
				<button
					type="button"
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap tracking-tight sm:tracking-normal"
					data-testid="events-no-results-chip-date"
					aria-label="Entfernen"
					onclick={() => eventsStore.clearDateFilter()}
				>
					{dateLabel}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/if}

			{#if eventsStore.hasAttendanceModeFilter && attendanceLabel}
				<button
					type="button"
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap tracking-tight sm:tracking-normal"
					data-testid="events-no-results-chip-attendance"
					aria-label="Entfernen"
					onclick={() => eventsStore.handleAttendanceModeChange(null)}
				>
					{attendanceLabel}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/if}
		</div>
	{/if}

	{#if eventsStore.hasLocationFilter}
		<div class="flex flex-col items-center gap-2" data-testid="events-no-results-radius">
			<p class="text-center text-sm text-base-content/60">Möchtest du den Radius erweitern?</p>
			<div class="flex flex-wrap items-center justify-center gap-2">
				{#if locationLabel}
					<span class="text-sm text-base-content/60" data-testid="events-no-results-location">
						{locationLabel}
					</span>
				{/if}
				<select
					class="select w-fit"
					data-testid="events-no-results-radius-select"
					value={selectedDistance}
					onchange={onRadiusChange}
				>
					<option value="">Überall</option>
					{#each ALLOWED_DISTANCE_VALUES as value (value)}
						<option {value}>{value} km Radius</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}
</div>
