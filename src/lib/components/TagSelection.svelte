<script lang="ts">
	import { getTags } from '$lib/rpc/TagSelection.remote';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { debounce } from '$lib/common';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { localeStore } from '../../locales/localeStore.svelte';

	const { allTags } = await getTags();
	type Tag = (typeof allTags)[number];

	let searchInput = $state<HTMLInputElement | null>(null);

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

	function buildSelectedTagSearchTerm() {
		return selectedTags.map((tag) => tag[locale]).join(' ');
	}

	function getInitialState() {
		let searchTerm = eventsStore.searchFilter || '';
		const matchedTags = parseSearchTermToTags(searchTerm);
		if (matchedTags.length > 0) searchTerm = '';
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

	const initialState = getInitialState();
	let filterQuery = $state(initialState.filterQuery);
	let selectedTags = $state<Tag[]>(initialState.selectedTags);
	let searchExpanded = $state(initialState.searchExpanded);
	let showTextSearch = $state(initialState.showTextSearch);
	let keywordSearched = $state(initialState.showTextSearch);
	let locale = $derived(localeStore.locale as 'en' | 'de');
	let showLeftShadow = $state(false);
	let showRightShadow = $state(false);

	eventsStore.showTextSearch = initialState.showTextSearch;

	let railTags = $derived.by(() => {
		const selectedTagIdSet = new Set(selectedTags.map((tag) => tag.id));
		return allTags.filter((tag) => !selectedTagIdSet.has(tag.id));
	});

	function openSearch() {
		searchExpanded = true;
	}

	function selectTag(tag: Tag) {
		selectedTags = [...selectedTags, tag];
		filterQuery = '';
		searchExpanded = false;
		setShowTextSearch(false);
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
	}

	function removeTag(tag: Tag) {
		selectedTags = selectedTags.filter((selectedTag) => selectedTag.id !== tag.id);
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
	}

	function runTextSearch(value?: string) {
		if (!value?.trim()) return;
		selectedTags = [];
		searchExpanded = true;
		filterQuery = value ?? '';
		setShowTextSearch(true);
		keywordSearched = Boolean((value ?? '').trim());
		debouncedSearch(value);
	}

	function handleSearchInput(value: string) {
		filterQuery = value;
		keywordSearched = false;
	}

	function handleSearchBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (filterQuery.trim()) return;

		const nextFocusedEl = e.relatedTarget;
		console.log(nextFocusedEl);
		if (nextFocusedEl instanceof HTMLElement) {
			const container = e.currentTarget.closest('label');
			console.log(container);
			if (container && nextFocusedEl.closest('label') === container) return;
			console.log('close search');
		}

		closeSearch();
	}

	function clearSearchQuery() {
		keywordSearched = false;
		filterQuery = '';
		showTextSearch = false;
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

<div class="flex w-full max-w-full min-w-0 items-center">
	<div class="relative flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-hidden pb-1">
		<div class={[`tag-trigger flex shrink-0 overflow-hidden`]}>
			<label
				class={[
					'input input-bordered min-w-0 rounded-r-none pr-1 ',
					keywordSearched && 'active font-semibold'
				]}
				onblur={handleSearchBlur}
			>
				<input
					bind:this={searchInput}
					class={[
						' min-w-0 transition-transform duration-50 ease-out',
						searchExpanded || showTextSearch ? `w-28` : `w-14`
					]}
					bind:value={filterQuery}
					onfocus={openSearch}
					oninput={(e) => handleSearchInput(e.currentTarget.value)}
					onblur={handleSearchBlur}
					onkeydown={(e) => {
						if (e.key === 'Enter' && filterQuery.trim()) {
							runTextSearch(filterQuery);
						}
					}}
					type="text"
					placeholder={searchExpanded || showTextSearch ? 'Suchbegriff' : 'Suchen'}
				/>
				{#if searchExpanded || showTextSearch}
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-circle hover:cursor-pointer"
						aria-label="Suchbegriff löschen"
						tabindex={filterQuery.trim() ? 0 : -1}
						onclick={clearSearchQuery}
					>
						<i class="icon-[ph--x] size-5"></i>
					</button>
				{/if}
			</label>
			<button
				class={[
					'btn rounded-l-none border-l-0 pl-3 hover:cursor-pointer',
					((searchExpanded || showTextSearch) && !keywordSearched) && 'btn-primary'
				]}
				title="Suche starten"
				onclick={() => {
					if (!filterQuery.trim()) {
						searchInput?.focus();
						return;
					}
					runTextSearch(filterQuery);
				}}
			>
				<i class="icon-[ph--magnifying-glass] size-5 min-w-5"></i>
			</button>
		</div>

		<div class="flex-no-wrap tag-trigger flex gap-2" class:hidden={selectedTags.length === 0}>
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
				class="tag-rail-scrollbar scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent flex w-full min-w-0 flex-nowrap items-center overflow-x-auto"
				{@attach trackTagRail}
				onscroll={(event) => updateTagRailShadows(event.currentTarget)}
				onwheel={(event) => handleTagRailWheel({ event, element: event.currentTarget })}
			>
				<div class="flex w-full min-w-0 flex-nowrap items-center gap-2">
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
						'from-base-200 via-base-200/70 pointer-events-none absolute top-0 right-0 bottom-0 flex items-center justify-center bg-linear-to-l to-transparent transition-all duration-300 ease-out',
						showRightShadow ? 'opacity-100' : 'opacity-0',
						showLeftShadow ? 'w-10' : 'w-25'
					]}
				></div>
				<!-- shadow left -->
				<div
					class={[
						'from-base-200 via-base-200/70 pointer-events-none absolute top-0 bottom-0 left-0 w-10 bg-linear-to-r to-transparent transition-opacity duration-300 ease-out',
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
