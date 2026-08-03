<script lang="ts">
	import Select from '$lib/components/Select.svelte';
	import { WEBSITE_SCRAPER_CONFIG } from '$lib/commonWithScripts';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { ALL_EVENT_SOURCES_VALUE } from '$lib/cookie-utils';
	import { setEventSourceFilter } from '$lib/rpc/admin.remote';

	let {
		sources,
		initialSource,
	}: {
		sources: string[];
		initialSource: string;
	} = $props();
	// svelte-ignore state_referenced_locally
	let selectedSource = $state(initialSource);
	let isSaving = $state(false);
	let saveError = $state<string | null>(null);

	const sourceOptions = $derived([
		{ value: ALL_EVENT_SOURCES_VALUE, html: `All` },
		...sources.map((source) => ({
			value: source,
			html: getSourceLabel(source),
		})),
	]);

	async function handleSourceChange(value: string | undefined) {
		if (!value || isSaving) return;

		const previous = selectedSource;
		selectedSource = value;
		isSaving = true;
		saveError = null;

		try {
			await setEventSourceFilter({ source: value });
			const source = value === ALL_EVENT_SOURCES_VALUE ? null : value;
			await eventsStore.loadEvents({
				...eventsStore.pagination,
				page: 1,
				source,
			});
		} catch (error) {
			selectedSource = previous;
			saveError = error instanceof Error ? error.message : `Failed to save source filter`;
			console.error(`Failed to save event source filter:`, error);
		} finally {
			isSaving = false;
		}
	}

	function getSourceLabel(source: string) {
		if (source in WEBSITE_SCRAPER_CONFIG) {
			return WEBSITE_SCRAPER_CONFIG[source as keyof typeof WEBSITE_SCRAPER_CONFIG].label;
		}
		return source;
	}
</script>

<div class="bg-warning text-warning-content flex w-full flex-col items-start gap-3 rounded-box p-4">
	<h3 class="flex items-center gap-2">
		<i class="icon-[ph--shield-star] size-5"></i>
		Admin Zeug
	</h3>
	<fieldset class="fieldset w-full">
		<legend class="fieldset-legend">Event Quelle Filter</legend>
		<Select
			value={selectedSource}
			placeholder="All"
			options={sourceOptions}
			onValueChange={handleSourceChange}
			disabled={isSaving}
			triggerProps={{ class: `w-full` }}
		/>
		{#if isSaving}
			<p class="label opacity-70">Wird gespeichert...</p>
		{:else if saveError}
			<p class="label text-error">{saveError}</p>
		{:else}
			<p class="label">
				{#if selectedSource === ALL_EVENT_SOURCES_VALUE}
					Es werden Events aus allen Quellen angezeigt.
				{:else}
					Es werden nur Events aus „{getSourceLabel(selectedSource)}“ angezeigt.
				{/if}
			</p>
		{/if}
	</fieldset>
</div>
