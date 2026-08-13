<script lang="ts">
	import { isTouchDevice } from '$lib/common';
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	let {
		id,
		query = $bindable(''),
		searched = $bindable(false),
		variant = 'full',
		wrapperClass = '',
		onSearch,
		onClose,
	}: {
		id?: string;
		query?: string;
		searched?: boolean;
		variant?: 'compact' | 'full';
		wrapperClass?: string | string[];
		onSearch?: (value: string) => void;
		onClose?: () => void;
	} = $props();

	let searchExpanded = $state(false);
	let searchInput = $state<HTMLInputElement | null>(null);
	let searchButton = $state<HTMLButtonElement | null>(null);
	let wrapperEl = $state<HTMLDivElement | null>(null);

	const isMdUp = new MediaQuery(`min-width: 768px`, true);
	const showField = $derived(variant === `full` || searchExpanded || searched || isMdUp.current);

	export function close() {
		closeSearch();
	}

	export async function focus() {
		await expandAndFocus();
	}

	export async function clearAndFocus() {
		searched = false;
		query = ``;
		onClose?.();
		await expandAndFocus();
	}

	async function expandAndFocus() {
		searchExpanded = true;
		await tick();
		searchInput?.focus();
	}

	function openSearch() {
		searchExpanded = true;
	}

	function handleSearchInput(value: string) {
		query = value;
		searched = false;
	}

	function handleSearchBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (query.trim()) return;

		const nextFocusedEl = e.relatedTarget;
		if (nextFocusedEl instanceof HTMLElement && wrapperEl?.contains(nextFocusedEl)) return;

		closeSearch();
	}

	function closeSearch() {
		searched = false;
		query = ``;
		searchExpanded = false;
		onClose?.();
	}

	function runTextSearch(value?: string) {
		if (!value?.trim()) return;
		searchExpanded = true;
		query = value.trim();
		searched = true;
		onSearch?.(query);
		if (isTouchDevice()) {
			searchButton?.focus();
		}
	}

	function clearSearchQuery() {
		closeSearch();
	}

	async function handleSearchButtonClick() {
		if (!showField) {
			await expandAndFocus();
			return;
		}
		if (!query.trim()) {
			searchInput?.focus();
			return;
		}
		runTextSearch(query);
	}
</script>

<div
	bind:this={wrapperEl}
	class={[
		`shrink-0`,
		variant === `full` ? [`join`, `w-full`] : [`tag-trigger`, `flex`, `items-center`],
		wrapperClass,
	]}
>
	{#if showField}
		<label
			class={[
				`input input-bordered min-w-0 pr-1`,
				variant === `full` ? [`join-item`, `w-full`] : `rounded-r-none`,
				searched && `active font-semibold`,
			]}
			onblur={handleSearchBlur}
		>
			<input
				{id}
				bind:this={searchInput}
				data-testid="event-search-input"
				class={[
					`min-w-0`,
					searchExpanded && `w-25`,
					variant === `compact` && `w-15`,
					variant === `full` && `w-full`,
				]}
				bind:value={query}
				onfocus={openSearch}
				oninput={(e) => handleSearchInput(e.currentTarget.value)}
				onblur={handleSearchBlur}
				onkeydown={(e) => {
					if (e.key === `Enter` && query.trim()) {
						runTextSearch(query);
					}
				}}
				type="text"
				placeholder={searchExpanded || searched ? `Suchbegriff` : `Suchen`}
			/>
			{#if searchExpanded || searched}
				<button
					type="button"
					class="btn btn-ghost btn-sm btn-circle hover:cursor-pointer"
					aria-label="Suchbegriff löschen"
					tabindex={query.trim() ? 0 : -1}
					onclick={clearSearchQuery}
				>
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/if}
		</label>
	{/if}
	<button
		bind:this={searchButton}
		class={[
			`btn hover:cursor-pointer`,
			variant === `full` && [`join-item`, `pl-3`],
			variant === `compact` && !showField && `btn-circle`,
			variant === `compact` && showField && [`rounded-l-none`, `border-l-0`, `pl-3`],
			searchExpanded && !searched && `btn-primary`,
		]}
		title={showField ? `Suche starten` : `Suche öffnen`}
		aria-label={showField ? `Suche starten` : `Suche öffnen`}
		onclick={handleSearchButtonClick}
	>
		<i class="icon-[ph--magnifying-glass] size-5 min-w-5"></i>
	</button>
</div>

<style>
	.tag-trigger {
		padding-bottom: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		.tag-trigger {
			padding-bottom: 10px;
		}
	}
</style>
