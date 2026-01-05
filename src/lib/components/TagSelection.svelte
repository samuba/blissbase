<script lang="ts">
	import { getTags } from './TagSelection.remote';
	import PopOver from './PopOver.svelte';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { debounce } from '$lib/common';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { localeStore } from '../../locales/localeStore.svelte';

	const { allTags, previewTags } = await getTags();
	type Tag = (typeof allTags)[number];

	// Parse initial search term into matched tags (must run synchronously before first render)
	const initialTerm = eventsStore.searchFilter || '';
	const initialSearchWords =
		initialTerm
			.trim()
			.match(/(?:[^\s"]+|"[^"]*")+/g)
			?.map((word) => word.replace(/^"|"$/g, '')) || [];
	const initialMatchedTags = allTags.filter((tag) =>
		initialSearchWords.some(
			(word) =>
				tag.en?.toLowerCase() === word.toLowerCase() ||
				tag.de?.toLowerCase() === word.toLowerCase() ||
				tag.nl?.toLowerCase() === word.toLowerCase()
		)
	);

	// Set showTextSearch BEFORE first render to avoid state change during mount
	if (initialTerm.trim() && initialMatchedTags.length === 0) {
		eventsStore.showTextSearch = true;
	}

	let showDropdown = $state(false);
	let filterQuery = $state(initialTerm);
	let filterQueryInPopup = $state('');
	let selectedTags = $state<Tag[]>(initialMatchedTags);
	let filterInputRef = $state<HTMLInputElement | null>(null);
	let textSearchInputRef = $state<HTMLInputElement | null>(null);


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
		filterQuery = value ?? '';
		filterQueryInPopup = '';
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

	function focusPopupInput() {
		requestAnimationFrame(() => filterInputRef?.focus());
	}

	// Auto-focus input when popup opens
	$effect(() => {
		if (showDropdown) focusPopupInput();
	});

</script>


{#if eventsStore.showTextSearch}
	<div class="flex flex-grow items-center gap-2" in:fade={{ duration: 280 }}>
		<label class="input w-full flex-grow">
			<i class="icon-[ph--magnifying-glass] text-base-600 size-5 min-w-5"></i>
			<input
				class="w-full"
				bind:value={filterQuery}
				bind:this={textSearchInputRef}
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
						textSearchInputRef?.focus();
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
		<button class="btn btn-circle" onclick={closeTextSearch} title="Textsuche schließen">
			<i class="icon-[ph--x] size-5"></i>
		</button>
	</div>
{:else}
	<!-- Show tags with fade effect and overlay dropdown -->
	<div
		class="relative flex w-full max-w-full min-w-0 items-center overflow-hidden"
		in:fade={{ duration: 280 }}
	>
		<!-- Tags container - no wrap, overflow hidden -->
		<div class="flex w-full min-w-0 flex-shrink flex-nowrap gap-2 overflow-hidden pr-12">
			{#each selectedTags as tag (tag.id)}
				<button
					class="btn active min-w-fit gap-2"
					onclick={() => removeTag(tag)}
					in:fade={{ duration: 280 }}
					animate:flip={{ duration: 280 }}
				>
					{tag[localeStore.locale]}
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/each}

			{#each previewTags.filter((t) => !selectedTags.some((st) => st.id === t.id)) as tag}
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
		contentClass="bg-base-100 shadow-lg border-base-300 w-[250px] z-20"
		triggerClass={showTriggerShadow ? 'btn btn-circle bg-base-100 btn-sm' : 'btn bg-base-100'}
		contentProps={{
			side: 'bottom',
			align: 'center',
			collisionPadding: { top: 9999, bottom: 8, left: 8, right: 8 },
			onOpenAutoFocus: (e) => e.preventDefault() // ugly blue focus on close button in safari otherwise
		}}
		onOpenChange={handleOpenChange}
		bind:open={showDropdown}
	>
		{#snippet trigger()}
			{#if showTriggerShadow}
				<i
					class="icon-[ph--caret-right-bold] size-5 transition-transform {showDropdown
						? 'rotate-90'
						: ''}"
				></i>
			{:else}
				Mehr
			{/if}
		{/snippet}

		{#snippet content()}
			<div class="border-base-300 bg-base-200 flex flex-col gap-2 border-b-2 p-2 ">
				<label class="input w-full grow">
					<input
						class="w-full sm:w-fit"
						bind:value={filterQueryInPopup}
						bind:this={filterInputRef}
						type="text"
						placeholder="Suchen..."
						oninput={focusPopupInput}
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
								filterInputRef?.focus();
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
			{#each dropdownTags as tag (tag.id)}
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
