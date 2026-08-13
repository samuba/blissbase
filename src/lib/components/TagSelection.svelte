<script lang="ts">
	import type { UiTag } from '$lib/rpc/TagSelection.remote';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { localeStore } from '../../locales/localeStore.svelte';
	import TextSearchInput from '$lib/components/TextSearchInput.svelte';

	let { allTags }: { allTags: UiTag[] } = $props();

	let textSearchInput = $state<TextSearchInput | null>(null);

	/** Parses search term and returns matched tags */
	function parseSearchTermToTags(searchTerm: string): UiTag[] {
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
			keywordSearched: Boolean(searchTerm.trim()),
		};
	}

	function setShowTextSearch(value: boolean) {
		eventsStore.showTextSearch = value;
	}

	const initialState = getInitialState();
	let filterQuery = $state(initialState.filterQuery);
	let selectedTags = $state<UiTag[]>(initialState.selectedTags);
	let keywordSearched = $state(initialState.keywordSearched);
	let locale = $derived(localeStore.locale as 'en' | 'de');
	let showLeftShadow = $state(false);
	let showRightShadow = $state(false);
	let tagRailEl = $state<HTMLDivElement | null>(null);

	eventsStore.showTextSearch = initialState.keywordSearched;

	let railTags = $derived.by(() => {
		const selectedTagIdSet = new Set(selectedTags.map((tag) => tag.id));
		return allTags.filter((tag) => !selectedTagIdSet.has(tag.id));
	});

	function handleTextSearch(value: string) {
		selectedTags = [];
		setShowTextSearch(true);
		eventsStore.handleSearchTermChange(value);
	}

	function handleSearchClose() {
		setShowTextSearch(false);
		eventsStore.handleSearchTermChange('');
	}

	function selectTag(tag: UiTag) {
		selectedTags = [...selectedTags, tag];
		textSearchInput?.close();
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
	}

	function removeTag(tag: UiTag) {
		selectedTags = selectedTags.filter((selectedTag) => selectedTag.id !== tag.id);
		eventsStore.handleSearchTermChange(buildSelectedTagSearchTerm());
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

	function scrollTagRail(direction: `left` | `right`) {
		if (!tagRailEl) return;
		const amount = Math.max(tagRailEl.clientWidth * 0.75, 200);
		tagRailEl.scrollBy({
			left: direction === `left` ? -amount : amount,
			behavior: `smooth`,
		});
	}

	function trackTagRail(node: HTMLDivElement) {
		tagRailEl = node;
		const update = () => updateTagRailShadows(node);
		const resizeObserver = new ResizeObserver(update);
		resizeObserver.observe(node);
		requestAnimationFrame(update);

		return () => {
			resizeObserver.disconnect();
			if (tagRailEl === node) tagRailEl = null;
		};
	}
</script>

<div class="flex w-full max-w-full min-w-0 items-center">
	<div class="relative flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-hidden pb-1">
		<TextSearchInput
			bind:this={textSearchInput}
			bind:query={filterQuery}
			bind:searched={keywordSearched}
			variant="compact"
			onSearch={handleTextSearch}
			onClose={handleSearchClose}
		/>

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
							data-testid={`tag-chip-${tag.slug}`}
							onclick={() => selectTag(tag)}
						>
							{tag[locale] ?? tag.slug}
						</button>
					{/each}
				</div>
			</div>

			<!-- fade + chevron left -->
			<div
				class={[
					`tag-rail-fade h-full from-base-200 via-base-200/85 pointer-events-none absolute top-0 left-0 z-10 flex w-14 items-center justify-start bg-linear-to-r to-transparent transition-opacity duration-300 ease-out`,
					showLeftShadow ? `opacity-100` : `opacity-0`
				]}
			>
				<button
					type="button"
					class={[
						`tag-rail-chevron btn btn-circle btn-ghost btn-sm pointer-fine:mb-3`,
						showLeftShadow ? `pointer-events-auto` : `pointer-events-none`
					]}
					aria-label="Tags nach links scrollen"
					tabindex={showLeftShadow ? 0 : -1}
					onclick={() => scrollTagRail(`left`)}
				>
					<i class="icon-[ph--caret-left] size-5"></i>
				</button>
			</div>

			<!-- fade + chevron right -->
			<div
				class={[
					`tag-rail-fade h-full from-base-200 via-base-200/85 pointer-events-none absolute top-0 right-0 z-10 flex items-center justify-end bg-linear-to-l to-transparent transition-all duration-300 ease-out`,
					showRightShadow ? `opacity-100` : `opacity-0`,
					showLeftShadow ? `w-14` : `w-18`
				]}
			>
				<button
					type="button"
					class={[
						`tag-rail-chevron btn btn-circle btn-ghost btn-sm pointer-fine:mb-3`,
						showRightShadow ? `pointer-events-auto` : `pointer-events-none`
					]}
					aria-label="Tags nach rechts scrollen"
					tabindex={showRightShadow ? 0 : -1}
					onclick={() => scrollTagRail(`right`)}
				>
					<i class="icon-[ph--caret-right] size-5"></i>
				</button>
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

	/* Align fades/chevrons with tag buttons, excluding the horizontal scrollbar gutter */
	.tag-rail-fade {
		bottom: 8px;
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
