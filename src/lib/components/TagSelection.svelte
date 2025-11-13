<script lang="ts">
	import { getTags } from './TagSelection.remote';
	import PopOver from './PopOver.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { debounce } from '$lib/common';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { localeStore } from '../../locales/localeStore.svelte';

	let { tags }: { tags: Awaited<ReturnType<typeof getTags>> } = $props();

	const { allTags, previewTags } = $derived(tags);
	type Tag = (typeof allTags)[number];

	let showDropdown = $state(false);
	let filterQuery = $state(eventsStore.searchFilter || '');
	let filterQueryInPopup = $state('');
	let selectedTags = $state<Tag[]>([]);

	// sync selected tags with search term from store
	$effect(() => {
		// Split by spaces but keep quoted phrases together
		const term = eventsStore.pagination.searchTerm || '';
		const searchWords = term.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map(word => word.replace(/^"|"$/g, '') // Remove surrounding quotes
		) || [];
		selectedTags = allTags.filter(tag => 
			searchWords.some(word => 
				tag.en === word || tag.de === word || tag.nl === word
			)
		);
	})

	$effect(() => {
		filterQuery = eventsStore.searchFilter || '';
	})

	const selectedTagIds = $derived(new Set(selectedTags.map((t) => t.id)));
	const hiddenTags = $derived(allTags.filter((x) => !previewTags.includes(x)));
	const dropdownTags = $derived.by(() => {
		const normalizedQuery = filterQueryInPopup.trim().toLowerCase();
		// Filter out already selected tags
		const availableTags = allTags.filter((tag) => !selectedTagIds.has(tag.id));

		// When tags are selected, show all available tags
		if (selectedTags.length > 0) {
			if (!normalizedQuery) {
				return availableTags;
			}
			return availableTags.filter(
				(tag) =>
					tag.en?.toLowerCase().includes(normalizedQuery) ||
					tag.de?.toLowerCase().includes(normalizedQuery) ||
					tag.nl?.toLowerCase().includes(normalizedQuery)
			);
		}
		// When no tags are selected, show hidden tags or filtered results
		if (!normalizedQuery) {
			return hiddenTags;
		}
		return availableTags.filter(
			(tag) =>
				tag.en?.toLowerCase().includes(normalizedQuery) ||
				tag.de?.toLowerCase().includes(normalizedQuery) ||
				tag.nl?.toLowerCase().includes(normalizedQuery)
		);
	});
	const hasMoreTags = $derived(hiddenTags.length > 0 || selectedTags.length > 0);

	function handleOpenChange(open: boolean) {
		if (!open) filterQuery = '';
	}

	function selectTag(tag: Tag) {
		selectedTags.push(tag);
		filterQuery = '';
		showDropdown = false;
		eventsStore.handleSearchTermChange(selectedTags.map((t) => t[localeStore.locale]).join(' '));
		eventsStore.showTextSearch = false;
	}

	function removeTag(tag: Tag) {
		selectedTags = selectedTags.filter((t) => t.id !== tag.id);
		eventsStore.handleSearchTermChange(selectedTags.map((t) => t[localeStore.locale]).join(' '));
	}
 
	function runTextSearch(value?: string) {
		selectedTags = [];
		showDropdown = false;
		eventsStore.showTextSearch = true;
		debouncedSearch(value);
	}

	function closeTextSearch() {
		filterQuery = '';
		eventsStore.showTextSearch = false;
		eventsStore.handleSearchTermChange('');
	}

	const debouncedSearch = debounce<string | undefined>(
		(term) => eventsStore.handleSearchTermChange(term?.trim() || ''),
		400
	);

	function clearTags() {
		eventsStore.handleSearchTermChange('');
		filterQueryInPopup = '';
	}

$inspect(selectedTags);

</script>

{#if selectedTags.length > 0}
	<!-- Selected tags with individual clear buttons and "Clear All" option -->
	<div class="flex flex-wrap items-center gap-2" in:fade={{ duration: 280 }} >
		{#each selectedTags as tag (tag.id)}
			<button class="btn btn-primary min-w-fit gap-2" onclick={() => removeTag(tag)} in:fade={{ duration: 280 }} animate:flip={{ duration: 280 }} >
				{tag[localeStore.locale]}
				<i class="icon-[ph--x] size-5"></i>
			</button>
		{/each}

		<div class="relative">
			{@render moreTagsButton(false)}
		</div>
		{#if selectedTags.length > 1}
		<button
			class="btn btn-circle "
			onclick={clearTags}
			title="Textsuche schließen"
		>
			<i class="icon-[ph--x] size-5"></i>
		</button>
		{/if}
	</div>
{:else if eventsStore.showTextSearch}
	<div class="flex items-center gap-2 flex-grow" in:fade={{ duration: 280 }}>
		<label class="input w-full flex-grow">
			<i class="icon-[ph--magnifying-glass] text-base-600 size-5 min-w-5"></i>
			<input
				id="tag-selection-text-search-input w-full"
				bind:value={filterQuery}
				oninput={(e) => runTextSearch(e.currentTarget.value)}
				type="text"
				placeholder="Suchbegriff"
			/>
			<button
				onclick={() => {
					if (filterQuery.trim()) {
						filterQuery = '';
						eventsStore.handleSearchTermChange('');
					} else {
						document.getElementById('tag-selection-text-search-input')?.focus();
					}
				}}
				class="btn btn-sm btn-circle btn-ghost"
				aria-label="Suchbegriff löschen"
				class:opacity-0={!filterQuery.trim()}
				class:cursor-text={!filterQuery.trim()}
			>
				<i class="icon-[ph--x] text-base-600 size-5"></i>
			</button>
		</label>
		<button
			class="btn btn-circle "
			onclick={closeTextSearch}
			title="Textsuche schließen"
		>
			<i class="icon-[ph--x] size-5"></i>
		</button>
	</div>
{:else}
	<!-- Show tags with fade effect and overlay dropdown -->
	<div class="relative flex w-full max-w-full min-w-0 items-center overflow-hidden" in:fade={{ duration: 280 }}>
		<!-- Tags container - no wrap, overflow hidden -->
		<div class="flex w-full min-w-0 flex-shrink flex-nowrap gap-2 overflow-hidden pr-12">
			{#each previewTags as tag}
				<button
					class="btn bg-base-100 flex-shrink-0 font-normal whitespace-nowrap"
					onclick={() => selectTag(tag)}
				>
					{tag[localeStore.locale]}
				</button>
			{/each}
		</div>

		{#if hasMoreTags}
			<!-- Fade overlay gradient - gets stronger towards the right -->
			<div
				class="from-base-200 via-base-200/80 pointer-events-none absolute top-0 right-0 bottom-0 w-32 bg-gradient-to-l to-transparent"
			></div>

			<!-- Dropdown button positioned at the right edge, overlaying the tags -->
			<div class="absolute right-0 flex items-center">
				{@render moreTagsButton(true)}
			</div>
		{/if}
	</div>
{/if}

{#snippet moreTagsButton(showTriggerShadow: boolean)}
	<PopOver
		contentClass="bg-base-100 shadow-lg border-base-300 w-[250px]"
		triggerClass={showTriggerShadow ? 'btn btn-ghost ' : 'btn bg-base-100'}
		contentProps={{
			align: 'center',
			onOpenAutoFocus: (e) => e.preventDefault(), // ugly blue focus on close button in safari otherwise
		}}
		onOpenChange={handleOpenChange}
		bind:open={showDropdown}
	>
		{#snippet trigger()}
			{#if showTriggerShadow}
				<i
					class="icon-[ph--caret-right-bold]  size-6 transition-transform {showDropdown
						? 'rotate-90'
						: ''}"
				></i>
			{:else}
				Mehr
			{/if}
		{/snippet}

		{#snippet content()}
			<div class="border-base-300 bg-base-200 sticky top-0 flex flex-col gap-2 border-b-2 p-2">
				<label class="input w-full flex-grow">
					<input
						id="tag-selection-filter-input w-full sm:w-fit"
						bind:value={filterQueryInPopup}
						type="text"
						placeholder="Suchen..."
						onkeydown={(e) => {
							if (e.key === 'Enter' && filterQueryInPopup.trim()) {
								runTextSearch(filterQueryInPopup);
							}
						}}
					/>
					<button
						onclick={() => {
							if (filterQueryInPopup.trim()) {
								filterQueryInPopup = '';
							} else {
								document.getElementById('tag-selection-filter-input')?.focus();
							}
						}}
						class="btn btn-sm btn-circle btn-ghost"
						aria-label="Suchbegriff löschen"
						class:opacity-0={!filterQueryInPopup.trim()}
						class:cursor-text={!filterQueryInPopup.trim()}
					>
						<i class="icon-[ph--x] text-base-600 size-5"></i>
					</button>
				</label>


				<button
					onclick={() => runTextSearch(filterQueryInPopup)}
					class="btn btn-primary max-h-16 break-words whitespace-normal"
					disabled={!filterQueryInPopup.trim()}
				>
					<i class="icon-[ph--magnifying-glass] size-5"></i>
					Suchen
				</button>
			</div>
			{#if dropdownTags.length}
				<div
					class="scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent flex max-h-72 flex-col gap-2 overflow-y-auto p-2"
				>
					{#each dropdownTags as tag}
						<button
							class="btn mb-1 w-full text-center font-normal last:mb-0"
							onclick={() => selectTag(tag)}
						>
							{tag[localeStore.locale]}
						</button>
					{/each}
				</div>
			{/if}
		{/snippet}
	</PopOver>
{/snippet}
