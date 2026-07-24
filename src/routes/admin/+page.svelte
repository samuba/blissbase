<script lang="ts">
	import Select from '$lib/components/Select.svelte';
	import { WEBSITE_SCRAPER_CONFIG } from '$lib/commonWithScripts';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { routes } from '$lib/routes';
	import { ALL_EVENT_SOURCES_VALUE } from '$lib/cookie-utils';
	import {
		getEventSourceFilter,
		getEventSources,
		setEventSourceFilter,
	} from '$lib/rpc/admin.remote';

	const sources = await getEventSources();
	let selectedSource = $state(await getEventSourceFilter());
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
			eventsStore.clearCachedEvents();
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

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 mt-4 shadow">
		<div class="card-body gap-4">
			<div class="flex items-start gap-3">
				<div class="bg-primary/15 text-primary-content rounded-xl p-2.5">
					<i class="icon-[ph--shield-star] size-7"></i>
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<h1 class="text-lg font-semibold">Admin</h1>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Wähle, welche Event-Quellen auf der Startseite angezeigt werden.
					</p>
				</div>
			</div>

			<fieldset class="fieldset">
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
					<p class="label text-base-content/60">Wird gespeichert...</p>
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

			<div class="card-actions pt-1">
				<a href={routes.root()} class="btn">
					<i class="icon-[ph--arrow-left] size-4"></i>
					Zur Event-Liste
				</a>
			</div>
		</div>
	</div>
</div>
