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
				eventsStore.hasAttendanceModeFilter ||
				eventsStore.hasLocationFilter,
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
				<div class="badge badge-ghost break-keep gap-1 pr-0" data-testid="events-no-results-chip-search">
					{eventsStore.searchFilter}
					<button
						type="button"
						class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
						aria-label="Entfernen"
						onclick={() => eventsStore.handleSearchTermChange(``)}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			{/if}

			{#each selectedCategories as category (category.slug)}
				<div
					class="badge badge-ghost break-keep gap-1 pr-0"
					data-testid={`events-no-results-chip-category-${category.slug}`}
				>
					{category.label}
					<button
						type="button"
						class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
						aria-label="Entfernen"
						onclick={() => removeCategory(category.slug)}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			{/each}

			{#if eventsStore.hasDateFilter && dateLabel}
				<div class="badge badge-ghost break-keep gap-1 pr-0" data-testid="events-no-results-chip-date">
					{dateLabel}
					<button
						type="button"
						class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
						aria-label="Entfernen"
						onclick={() => eventsStore.clearDateFilter()}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			{/if}

			{#if eventsStore.hasAttendanceModeFilter && attendanceLabel}
				<div
					class="badge badge-ghost break-keep gap-1 pr-0"
					data-testid="events-no-results-chip-attendance"
				>
					{attendanceLabel}
					<button
						type="button"
						class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
						aria-label="Entfernen"
						onclick={() => eventsStore.handleAttendanceModeChange(null)}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			{/if}

			{#if locationLabel}
				<div
					class="badge badge-ghost break-keep gap-1 pr-0"
					data-testid="events-no-results-chip-location"
				>
					{locationLabel}
					<button
						type="button"
						class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
						aria-label="Entfernen"
						onclick={() =>
							eventsStore.handleLocationDistanceChange({
								location: null,
								distance: null,
								latitude: null,
								longitude: null,
							})}
					>
						<i class="icon-[ph--x] size-4"></i>
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if eventsStore.hasLocationFilter}
		<div class="flex flex-col items-center gap-2" data-testid="events-no-results-radius">
			<p class="text-center text-sm text-base-content/60">Möchtest du den Radius erweitern?</p>
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
	{/if}
</div>
