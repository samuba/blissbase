<script lang="ts">
	import { getTags } from '$lib/rpc/TagSelection.remote';
	import PopOver from './PopOver.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { debounce } from '$lib/common';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { localeStore } from '../../locales/localeStore.svelte';

	const { allTags } = await getTags();
	type Tag = (typeof allTags)[number];

	/** Parses search term and returns matched tags */
	function parseSearchTermToTags(searchTerm: string): Tag[] {
		const searchWords =
			searchTerm
				.trim()
				.match(/(?:[^\s"]+|"[^"]*")+/g)
				?.map((word) => word.replace(/^"|"$/g, '')) || [];
		return allTags.filter((tag) =>
			searchWords.some(
				(word) =>
					tag.en?.toLowerCase() === word.toLowerCase() ||
					tag.de?.toLowerCase() === word.toLowerCase() ||
					tag.nl?.toLowerCase() === word.toLowerCase()
			)
		);
	}

	function matchesTagQuery(args: { tag: Tag; query: string }) {
		return (
			args.tag.en?.toLowerCase().includes(args.query) ||
			args.tag.de?.toLowerCase().includes(args.query) ||
			args.tag.nl?.toLowerCase().includes(args.query)
		);
	}

	function buildSelectedTagSearchTerm() {
		return selectedTags.map((tag) => tag[locale]).join(' ');
	}

	function getInitialState() {
		const searchTerm = eventsStore.searchFilter || '';
		const matchedTags = parseSearchTermToTags(searchTerm);
		return {
			filterQuery: searchTerm,
			selectedTags: matchedTags,
			searchExpanded: Boolean(searchTerm.trim()),
			showTextSearch: Boolean(searchTerm.trim()) && matchedTags.length === 0
		};
	}

	function setShowTextSearch(value: boolean) {
		showTextSearch = value;
		eventsStore.showTextSearch = value;
	}

	function focusOnMount(node: HTMLInputElement) {
		requestAnimationFrame(() => node.focus());
	}

	const initialState = getInitialState();
	let filterQuery = $state(initialState.filterQuery);
	let selectedTags = $state<Tag[]>(initialState.selectedTags);
	let searchExpanded = $state(initialState.searchExpanded);
	let showTextSearch = $state(initialState.showTextSearch);
	let keywordSearched = $state(false);
	let locale = $derived(localeStore.locale as 'en' | 'de');
	let popoverOpen = $state(false);
	let allowPopoverOpen = $state(false);
	let showLeftShadow = $state(false);
	let showRightShadow = $state(false);

	eventsStore.showTextSearch = initialState.showTextSearch;

	let normalizedQuery = $derived(
		searchExpanded || showTextSearch ? filterQuery.trim().toLowerCase() : ''
	);
	let popoverTags = $derived.by(() => {
		const selectedTagIdSet = new Set(selectedTags.map((tag) => tag.id));
		const availableTags = allTags.filter((tag) => !selectedTagIdSet.has(tag.id));
		if (!normalizedQuery) return availableTags;
		return availableTags.filter((tag) => matchesTagQuery({ tag, query: normalizedQuery }));
	});
	let railTags = $derived.by(() => {
		const selectedTagIdSet = new Set(selectedTags.map((tag) => tag.id));
		return allTags.filter((tag) => !selectedTagIdSet.has(tag.id));
	});

	function openSearch() {
		searchExpanded = true;
		popoverOpen = false;
		allowPopoverOpen = false;
	}

	function selectTag(tag: Tag) {
		selectedTags = [...selectedTags, tag];
		filterQuery = '';
		searchExpanded = false;
		popoverOpen = false;
		setShowTextSearch(false);
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
	}

	function removeTag(tag: Tag) {
		selectedTags = selectedTags.filter((selectedTag) => selectedTag.id !== tag.id);
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
	}

	function runTextSearch(value?: string) {
		selectedTags = [];
		searchExpanded = true;
		filterQuery = value ?? '';
		popoverOpen = false;
		allowPopoverOpen = false;
		setShowTextSearch(true);
		keywordSearched = Boolean((value ?? '').trim());
		debouncedSearch(value);
	}

	function handleSearchInput(value: string) {
		filterQuery = value;
		keywordSearched = false;
		const hasQuery = Boolean(value.trim());
		allowPopoverOpen = hasQuery;
		popoverOpen = hasQuery;
	}

	function handleSearchBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (filterQuery.trim()) return;

		const nextFocusedEl = e.relatedTarget;
		if (nextFocusedEl instanceof HTMLElement) {
			const container = e.currentTarget.closest('label');
			if (container && nextFocusedEl.closest('label') === container) return;
		}

		closeSearch();
	}

	function clearSearchQuery() {
		keywordSearched = false;
		if (showTextSearch) {
			runTextSearch('');
			closeSearch();
			return;
		}

		filterQuery = '';
		popoverOpen = false;
		allowPopoverOpen = false;
		closeSearch();
	}

	function closeSearch() {
		keywordSearched = false;
		if (showTextSearch) {
			filterQuery = '';
			setShowTextSearch(false);
			eventsStore.handleSearchTermChange('');
		} else {
			filterQuery = '';
		}

		searchExpanded = false;
		popoverOpen = false;
		allowPopoverOpen = false;
	}

	/** Maps vertical wheel movement to horizontal tag scrolling. */
	function handleTagRailWheel(args: { event: WheelEvent; element: HTMLDivElement }) {
		if (args.element.scrollWidth <= args.element.clientWidth) return;
		if (Math.abs(args.event.deltaX) > Math.abs(args.event.deltaY)) return;

		args.event.preventDefault();
		args.element.scrollBy({ left: args.event.deltaY });
	}

	function updateTagRailShadows(element: HTMLDivElement) {
		const tolerance = 2;
		const hasOverflow = element.scrollWidth - element.clientWidth > tolerance;
		if (!hasOverflow) {
			showLeftShadow = false;
			showRightShadow = false;
			return;
		}

		const isAtStart = element.scrollLeft <= tolerance;
		const isAtEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - tolerance;

		showLeftShadow = !isAtStart;
		showRightShadow = !isAtEnd;
	}

	function trackTagRail(node: HTMLDivElement) {
		const update = () => updateTagRailShadows(node);
		const resizeObserver = new ResizeObserver(update);
		resizeObserver.observe(node);
		requestAnimationFrame(update);

		return () => {
			resizeObserver.disconnect();
		};
	}

	const debouncedSearch = debounce<string | undefined>(
		(term) => eventsStore.handleSearchTermChange(term?.trim() || ''),
		400
	);
</script>

<div class="flex w-full max-w-full min-w-0 items-center " in:fade={{ duration: 280 }}>
	<div
		class="flex w-full min-w-0 flex-nowrap items-center gap-2 pb-1 overflow-hidden relative"
	>
		<PopOver
			bind:open={popoverOpen}
			triggerClass="shrink-0"
			contentClass="bg-base-100 shadow-lg border-base-300 w-[280px] z-20"
			contentProps={{
				side: 'bottom',
				align: 'start',
				sideOffset: 10,
				collisionPadding: { top: 8, bottom: 8, left: 8, right: 8 },
				onOpenAutoFocus: (e) => e.preventDefault()
			}}
			onOpenChange={(open) => {
				if (open && !allowPopoverOpen) {
					popoverOpen = false;
					return;
				}
				popoverOpen = open;
			}}
		>
			{#snippet trigger()}
				<div
					class={[
						'tag-trigger shrink-0 overflow-hidden transition-all duration-300 ease-out',
						searchExpanded || showTextSearch && 'w-42'
					]}
				>
					{#if searchExpanded || showTextSearch}
						<label
							class={[
								'input input-bordered min-w-0 gap-2 pr-1',
								keywordSearched && 'active'
							]}
							onblur={handleSearchBlur}
						>
							<i class="icon-[ph--magnifying-glass] text-base-600 size-5 min-w-5"></i>
							<input
								id="tag-search-input"
								class="w-full min-w-0 "
								bind:value={filterQuery}
								{@attach focusOnMount}
								oninput={(e) => handleSearchInput(e.currentTarget.value)}
								onblur={handleSearchBlur}
								onkeydown={(e) => {
									if (e.key === 'Enter' && filterQuery.trim()) {
										runTextSearch(filterQuery);
									}
								}}
								type="text"
								placeholder="Tags oder Suchbegriff"
							/>
							<button
								class="btn btn-ghost btn-sm btn-circle" class:opacity-0={!filterQuery.trim()}
								aria-label="Suchbegriff löschen"
								disabled={!filterQuery.trim()}
								tabindex={filterQuery.trim() ? 0 : -1}
								onclick={() => {
									if (filterQuery.trim()) {
										clearSearchQuery();
										return;
									}
									popoverOpen = false;
								}}
							>
								<i class="icon-[ph--x] size-5"></i>
							</button>
						</label>
					{:else}
						<div
							class="btn btn-circle bg-base-100 "
							aria-controls="tag-search-input"
							aria-expanded={searchExpanded || showTextSearch}
							role="button"
							tabindex="0"
							aria-label="Suche öffnen"
							onclick={openSearch}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									openSearch();
								}
							}}
						>
							<i class="icon-[ph--magnifying-glass] size-5"></i>
						</div>
					{/if}
				</div>
			{/snippet}

			{#snippet content()}
				<div class="border-base-300 bg-base-200 flex flex-col gap-2 border-b-2 p-2">
					{#if filterQuery.trim()}
						<button
							class="btn btn-primary btn-sm w-full"
							onclick={() => runTextSearch(filterQuery)}
						>
							<i class="icon-[ph--magnifying-glass] size-5"></i>
							<strong>{filterQuery.trim()}</strong> suchen
						</button>
					{/if}
				</div>

				{#if popoverTags.length > 0}
					<div class="scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent flex max-h-72 flex-col gap-2 overflow-y-auto p-2">
						{#each popoverTags as tag (tag.id)}
							<button
								class="btn w-full text-center font-normal"
								onclick={() => selectTag(tag)}
							>
								{tag[locale] ?? tag.slug}
							</button>
						{/each}
					</div>
				{/if}
			{/snippet}
		</PopOver>

		<div class="flex flex-no-wrap gap-2 tag-trigger">
			{#each selectedTags as tag (tag.id)}
				<button
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap"
					onclick={() => removeTag(tag)}
					in:fade={{ duration: 280 }}
					animate:flip={{ duration: 280 }}
				>
					{tag[locale]}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/each}
		</div>

		<div class="relative w-full overflow-hidden">		
			<div 
				class="overflow-x-auto flex w-full min-w-0 flex-nowrap items-center gap-2  tag-rail-scrollbar scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent "
				{@attach trackTagRail}
				onscroll={(event) => updateTagRailShadows(event.currentTarget)}
				onwheel={(event) => handleTagRailWheel({ event, element: event.currentTarget })}
			>
				<div 
					class="flex w-full min-w-0 flex-nowrap items-center gap-2"
				>	
					{#each railTags as tag (tag.id)}
						<button
							class="btn bg-base-100 min-w-fit shrink-0 font-normal whitespace-nowrap"
							onclick={() => selectTag(tag)}
						>
							{tag[locale] ?? tag.slug}
						</button>
					{/each}
				</div>
				<!-- shadow right -->
				<div
					class={[
						'flex items-center justify-center from-base-200 via-base-200/70 pointer-events-none absolute top-0 right-0 bottom-0 bg-linear-to-l to-transparent transition-all duration-300 ease-out',
						showRightShadow ? 'opacity-100' : 'opacity-0', showLeftShadow ? 'w-10' : 'w-25'
					]}
				>
				</div>
				<!-- shadow left -->
				<div
					class={[
						'from-base-200 via-base-200/70 pointer-events-none absolute top-0 left-0 bottom-0 w-10 bg-linear-to-r to-transparent transition-opacity duration-300 ease-out',
						showLeftShadow ? 'opacity-100' : 'opacity-0'
					]}
				></div>
			</div>
		</div>
	</div>
</div>

<style>
	.tag-rail-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		scrollbar-gutter: stable;
	}

	.tag-trigger {
		padding-bottom: 0;
	}

	.tag-rail-scrollbar::-webkit-scrollbar {
		height: 6px;
	}

	.tag-rail-scrollbar:hover,
	.tag-rail-scrollbar:focus-within {
		scrollbar-color: hsl(var(--b3)) transparent;
	}

	.tag-rail-scrollbar::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 999px;
	}

	.tag-rail-scrollbar:hover::-webkit-scrollbar-thumb,
	.tag-rail-scrollbar:focus-within::-webkit-scrollbar-thumb {
		background: hsl(var(--b3));
	}

	@media (max-width: 640px) {
		.tag-rail-scrollbar::-webkit-scrollbar {
			height: 4px;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.tag-trigger {
			padding-bottom: 10px;
		}
	}
</style>
