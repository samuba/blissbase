<script lang="ts">
	import { eventCategories } from '$lib/eventCategories';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import TextSearchInput from '$lib/components/TextSearchInput.svelte';

	let textSearchInput = $state<TextSearchInput | null>(null);

	const initialSearchTerm = eventsStore.searchFilter || ``;
	const initialKeywordSearched = Boolean(initialSearchTerm.trim());
	let filterQuery = $state(initialSearchTerm);
	let keywordSearched = $state(initialKeywordSearched);
	let showLeftShadow = $state(false);
	let showRightShadow = $state(false);
	let categoryRailEl = $state<HTMLDivElement | null>(null);

	eventsStore.showTextSearch = initialKeywordSearched;

	let selectedSlugs = $derived(eventsStore.pagination.categorySlugs ?? []);
	let selectedCategories = $derived(
		selectedSlugs
			.map((slug) => eventCategories.find((category) => category.slug === slug))
			.filter((category) => category != null),
	);
	let railCategories = $derived(eventCategories.filter((category) => !selectedSlugs.includes(category.slug)));

	function setShowTextSearch(value: boolean) {
		eventsStore.showTextSearch = value;
	}

	function handleTextSearch(value: string) {
		setShowTextSearch(true);
		eventsStore.handleSearchTermChange(value);
	}

	function handleSearchClose() {
		setShowTextSearch(false);
		eventsStore.handleSearchTermChange(``);
	}

	function selectCategory(slug: string) {
		textSearchInput?.close();
		keywordSearched = false;
		filterQuery = ``;
		setShowTextSearch(false);
		eventsStore.handleCategoryChange([...selectedSlugs, slug]);
	}

	function removeCategory(slug: string) {
		eventsStore.handleCategoryChange(selectedSlugs.filter((selectedSlug) => selectedSlug !== slug));
	}

	/** Maps vertical wheel movement to horizontal category scrolling. */
	function handleCategoryRailWheel(args: { event: WheelEvent; element: HTMLDivElement }) {
		if (args.element.scrollWidth <= args.element.clientWidth) return;
		if (Math.abs(args.event.deltaX) > Math.abs(args.event.deltaY)) return;

		args.event.preventDefault();
		args.element.scrollBy({ left: args.event.deltaY });
	}

	function updateCategoryRailShadows(element: HTMLDivElement) {
		const content = element.firstElementChild;
		const firstChip = content?.firstElementChild;
		const lastChip = content?.lastElementChild;
		if (!(firstChip instanceof HTMLElement) || !(lastChip instanceof HTMLElement)) {
			showLeftShadow = false;
			showRightShadow = false;
			return;
		}

		const tolerance = 2;
		const railRect = element.getBoundingClientRect();

		showLeftShadow = firstChip.getBoundingClientRect().left < railRect.left - tolerance;
		showRightShadow = lastChip.getBoundingClientRect().right > railRect.right + tolerance;
	}

	function scrollCategoryRail(direction: `left` | `right`) {
		if (!categoryRailEl) return;
		const amount = Math.max(categoryRailEl.clientWidth * 0.75, 200);
		categoryRailEl.scrollBy({
			left: direction === `left` ? -amount : amount,
			behavior: `smooth`,
		});
	}

	function trackCategoryRail(node: HTMLDivElement) {
		categoryRailEl = node;
		const update = () => updateCategoryRailShadows(node);
		const resizeObserver = new ResizeObserver(update);
		resizeObserver.observe(node);
		const content = node.firstElementChild;
		if (content) resizeObserver.observe(content);
		requestAnimationFrame(update);

		return () => {
			resizeObserver.disconnect();
			if (categoryRailEl === node) categoryRailEl = null;
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

		<div class={[`flex-no-wrap category-trigger flex gap-2`, selectedCategories.length === 0 && `hidden`]}>
			{#each selectedCategories as category (category.slug)}
				<button
					class="btn active min-w-fit shrink-0 gap-2 whitespace-nowrap tracking-tight sm:tracking-normal"
					data-testid={`category-chip-${category.slug}`}
					onclick={() => removeCategory(category.slug)}
					in:fade={{ duration: 280 }}
					animate:flip={{ duration: 280 }}
				>
					{category.label}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/each}
		</div>

		<div class="relative w-full overflow-hidden">
			<div
				class="category-rail-scrollbar scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent flex w-full min-w-0 flex-nowrap items-center overflow-x-auto"
				{@attach trackCategoryRail}
				onscroll={(event) => updateCategoryRailShadows(event.currentTarget)}
				onwheel={(event) => handleCategoryRailWheel({ event, element: event.currentTarget })}
			>
				<div class="flex w-max flex-nowrap items-center gap-2">
					{#each railCategories as category (category.slug)}
						<button
							class="btn bg-base-100 min-w-fit shrink-0 font-normal whitespace-nowrap tracking-tight sm:tracking-normal"
							data-testid={`category-chip-${category.slug}`}
							onclick={() => selectCategory(category.slug)}
						>
							{category.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- fade + chevron left -->
			<div
				class={[
					`category-rail-fade h-full from-base-200 via-base-200/85 pointer-events-none absolute top-0 left-0 z-10 flex w-14 items-center justify-start bg-linear-to-r to-transparent transition-opacity duration-300 ease-out`,
					showLeftShadow ? `opacity-100` : `opacity-0`,
				]}
			>
				<button
					type="button"
					class={[
						`category-rail-chevron btn btn-circle btn-ghost btn-sm pointer-fine:mb-3`,
						showLeftShadow ? `pointer-events-auto` : `pointer-events-none`,
					]}
					aria-label="Kategorien nach links scrollen"
					tabindex={showLeftShadow ? 0 : -1}
					onclick={() => scrollCategoryRail(`left`)}
				>
					<i class="icon-[ph--caret-left] size-5"></i>
				</button>
			</div>

			<!-- fade + chevron right -->
			<div
				class={[
					`category-rail-fade h-full from-base-200 via-base-200/85 pointer-events-none absolute top-0 right-0 z-10 flex items-center justify-end bg-linear-to-l to-transparent transition-all duration-300 ease-out`,
					showRightShadow ? `opacity-100` : `opacity-0`,
					showLeftShadow ? `w-14` : `w-18`,
				]}
			>
				<button
					type="button"
					class={[
						`category-rail-chevron btn btn-circle btn-ghost btn-sm pointer-fine:mb-3`,
						showRightShadow ? `pointer-events-auto` : `pointer-events-none`,
					]}
					aria-label="Kategorien nach rechts scrollen"
					tabindex={showRightShadow ? 0 : -1}
					onclick={() => scrollCategoryRail(`right`)}
				>
					<i class="icon-[ph--caret-right] size-5"></i>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.category-rail-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		scrollbar-gutter: stable;
	}

	/* Align fades/chevrons with category buttons, excluding the horizontal scrollbar gutter */
	.category-rail-fade {
		bottom: 8px;
	}

	.category-trigger {
		padding-bottom: 0;
	}

	.category-rail-scrollbar::-webkit-scrollbar {
		height: 6px;
	}

	.category-rail-scrollbar:hover,
	.category-rail-scrollbar:focus-within {
		scrollbar-color: hsl(var(--b3)) transparent;
	}

	.category-rail-scrollbar::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 999px;
	}

	.category-rail-scrollbar:hover::-webkit-scrollbar-thumb,
	.category-rail-scrollbar:focus-within::-webkit-scrollbar-thumb {
		background: hsl(var(--b3));
	}

	@media (max-width: 640px) {
		.category-rail-scrollbar::-webkit-scrollbar {
			height: 4px;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.category-trigger {
			padding-bottom: 10px;
		}
	}
</style>
