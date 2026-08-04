<script lang="ts">
	import { page } from '$app/state';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import { onMount } from 'svelte';
	import { showLoginDialog } from './LoginDialog.svelte';

	const NON_TEXT_INPUT_TYPES = new Set([
		`button`,
		`checkbox`,
		`color`,
		`file`,
		`hidden`,
		`image`,
		`radio`,
		`range`,
		`reset`,
		`submit`
	]);

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
	const navItems = $derived(getAppNavItems());
	let keyboardInset = $state(0);
	let isTextEntryFocused = $state(false);
	// Browser toolbars can shrink the visual viewport by ~100px, virtual keyboards by far more.
	const keyboardOpen = $derived(isTextEntryFocused && keyboardInset > 150);

	/**
	 * Detect a text-entry element, since only those open a virtual keyboard.
	 * Focus alone is not enough: pinch-zoom shrinks the visual viewport too.
	 */
	function isTextEntry(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) {
			return false;
		}

		if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
			return true;
		}

		if (!(target instanceof HTMLInputElement)) {
			return false;
		}

		return !NON_TEXT_INPUT_TYPES.has(target.type);
	}

	function handleFocusIn(event: FocusEvent) {
		isTextEntryFocused = isTextEntry(event.target);
	}

	// Hide the tab bar while the virtual keyboard is open (avoids the fixed-bottom gap).
	onMount(() => {
		const visualViewport = window.visualViewport;
		if (!visualViewport) {
			return;
		}

		const syncKeyboardInset = () => {
			// `scale` normalizes pinch-zoom, where the visual viewport shrinks without a keyboard.
			const visibleHeight = visualViewport.height * visualViewport.scale;
			keyboardInset = Math.max(
				0,
				window.innerHeight - visibleHeight - visualViewport.offsetTop
			);
		};

		visualViewport.addEventListener(`resize`, syncKeyboardInset);
		visualViewport.addEventListener(`scroll`, syncKeyboardInset, { passive: true });
		syncKeyboardInset();

		return () => {
			visualViewport.removeEventListener(`resize`, syncKeyboardInset);
			visualViewport.removeEventListener(`scroll`, syncKeyboardInset);
		};
	});
</script>

<svelte:document
	onfocusin={handleFocusIn}
	onfocusout={() => (isTextEntryFocused = false)}
/>

<nav
	aria-label="Hauptnavigation mobil"
	class={[
		`fixed inset-x-0 bottom-0 z-50 border-t border-base-300/80 bg-base-100 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] md:hidden`,
		keyboardOpen && `invisible pointer-events-none`
	]}
>
	<ul class="grid grid-cols-4 px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
		{#each navItems as tab (tab.href)}
			{@const isActive = isActiveAppTab(pathname, tab.href)}
			{@const icon = isActive ? tab.iconActive : tab.icon}
			<li>
				{#if tab.requireLogin && !userId}
					<button
						type="button"
						onclick={showLoginDialog}
						class={[
							`flex min-h-10 w-full flex-col items-center justify-center rounded-2xl transition-colors`,
							isActive ? `text-primary-btn-border font-bold` : `text-base-content/65`
						]}
					>
						<i class={[icon, `size-6`]}></i>
						<span class="text-[0.7rem] font-medium">{tab.label}</span>
					</button>
				{:else}
					<a
						href={tab.href}
						aria-current={isActive ? `page` : undefined}
						class={[
							`flex min-h-10 w-full flex-col items-center justify-center rounded-2xl transition-colors`,
							isActive ? `text-primary-btn-border font-bold` : `text-base-content/65`
						]}
					>
						<i class={[icon, `size-6`]}></i>
						<span class="text-[0.7rem] font-medium">{tab.label}</span>
					</a>
				{/if}
			</li>
		{/each}
	</ul>
</nav>
