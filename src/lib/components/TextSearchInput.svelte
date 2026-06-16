<script lang="ts">
	import { isTouchDevice } from '$lib/common';

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

	$effect(() => {
		if (searched) searchExpanded = true;
	});

	export function close() {
		closeSearch();
	}

	export function focus() {
		searchInput?.focus();
	}

	export function clearAndFocus() {
		closeSearch();
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
		if (nextFocusedEl instanceof HTMLElement) {
			const container = e.currentTarget.closest(`label`);
			if (container && nextFocusedEl.closest(`label`) === container) return;
		}

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
</script>

<div
	class={[
		`shrink-0`,
		variant === `full` ? [`join`, `w-full`] : [`tag-trigger`, `flex`, `overflow-hidden`],
		wrapperClass,
	]}
>
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
			class={[
				`min-w-0`,
				variant === `compact` && [`transition-transform duration-50 ease-out`, searchExpanded ? `w-28` : `w-14`],
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
			placeholder={searchExpanded ? `Suchbegriff` : `Suchen`}
		/>
		{#if searchExpanded}
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
	<button
		bind:this={searchButton}
		class={[
			`btn pl-3 hover:cursor-pointer`,
			variant === `full` ? `join-item` : [`rounded-l-none`, `border-l-0`],
			searchExpanded && !searched && `btn-primary`,
		]}
		title="Suche starten"
		aria-label="Suche starten"
		onclick={() => {
			if (!query.trim()) {
				searchInput?.focus();
				return;
			}
			runTextSearch(query);
		}}
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
