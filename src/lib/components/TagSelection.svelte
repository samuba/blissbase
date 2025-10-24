<script lang="ts">
	import { getTags } from './TagSelection.remote';
	import PopOver from './PopOver.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { debounce } from '$lib/common';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	let { tags }: { tags: Awaited<ReturnType<typeof getTags>> } = $props();

	const { allTags, previewTags } = $derived(tags);
	type Tag = (typeof allTags)[number];

	let showDropdown = $state(false);
	let filterQuery = $state(eventsStore.searchFilter || '');
	let selectedTags = $state<Tag[]>([]);

	// Sync selected tags with store 
	$effect(() => {
		if (eventsStore.pagination.tagIds?.length) {
			const storeTags = allTags.filter((t) => eventsStore.pagination.tagIds?.includes(t.id));
			// Only update if tags have actually changed
			const currentIds = selectedTags
				.map((t) => t.id)
				.sort()
				.join(',');
			const storeIds = storeTags
				.map((t) => t.id)
				.sort()
				.join(',');
			if (currentIds !== storeIds) {
				selectedTags = storeTags;
			}
		} else if (!eventsStore.pagination.tagIds?.length && selectedTags.length > 0) {
			// Clear selection when filter is reset
			selectedTags = [];
		}
	});

	const selectedTagIds = $derived(new Set(selectedTags.map((t) => t.id)));
	const hiddenTags = $derived(allTags.filter((x) => !previewTags.includes(x)));
	const dropdownTags = $derived.by(() => {
		const normalizedQuery = filterQuery.trim().toLowerCase();
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
		eventsStore.handleTagsChange(selectedTags.map((t) => t.id));
	}

	function removeTag(tag: Tag) {
		selectedTags = selectedTags.filter((t) => t.id !== tag.id);
		eventsStore.handleTagsChange(selectedTags.map((t) => t.id));
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
		eventsStore.handleTagsChange([]);
	}

</script>

{#if selectedTags.length > 0}
	<!-- Selected tags with individual clear buttons and "Clear All" option -->
	<div class="flex flex-wrap items-center gap-2" in:fade={{ duration: 280 }} >
		<div class="flex ">

			{#each selectedTags as tag (tag.id)}
				<button class="btn btn-primary min-w-fit gap-2" onclick={() => removeTag(tag)} in:fade={{ duration: 280 }} animate:flip={{ duration: 280 }} >
					{tag.de}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/each}
		</div>

		<div class="relative">
			{@render moreTagsButton(false)}
		</div>
		<button
			class="btn btn-circle "
			onclick={clearTags}
			title="Textsuche schließen"
		>
			<i class="icon-[ph--x] size-5"></i>
		</button>
	</div>
{:else if eventsStore.searchFilter || eventsStore.showTextSearch}
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
					{tag.de}
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
			onOpenAutoFocus: (e) => e.preventDefault()
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
						bind:value={filterQuery}
						type="text"
						placeholder="Suchen..."
					/>
					<button
						onclick={() => {
							if (filterQuery.trim()) {
								filterQuery = '';
							} else {
								document.getElementById('tag-selection-filter-input')?.focus();
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
					onclick={() => {
						runTextSearch(filterQuery);
					}}
					class="btn btn-primary max-h-16 break-words whitespace-normal"
					disabled={!filterQuery.trim()}
				>
					<i class="icon-[ph--magnifying-glass] size-5"></i>
					In Event Texten suchen
				</button>
			</div>
			<div
				class="scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent flex max-h-72 flex-col gap-2 overflow-y-auto p-2"
			>
				{#each dropdownTags as tag}
					<button
						class="btn mb-1 w-full text-center font-normal last:mb-0"
						onclick={() => selectTag(tag)}
					>
						{tag.de}
					</button>
				{:else}
					<div
						class="text-sm text-base-content/50 py-2 text-center flex flex-col items-center gap-4"
					>
						<span>
							Kein Tag gefunden für <b class="font-bold">{filterQuery}</b>
						</span>
					</div>
				{/each}
			</div>
		{/snippet}
	</PopOver>
{/snippet}
