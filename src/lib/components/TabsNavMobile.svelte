<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
	let isMoreMenuOpen = $state(false);

	/**
	 * Toggle the mobile `Mehr` menu.
	 * Example: tapping the bottom-nav trigger flips the menu open state.
	 */
	function toggleMoreMenu() {
		isMoreMenuOpen = !isMoreMenuOpen;
	}

	/**
	 * Close the mobile `Mehr` menu when the interaction is outside.
	 * Example: tapping anywhere outside the trigger or popup closes it.
	 */
	function handleDocumentClick(event: MouseEvent) {
		if (!isMoreMenuOpen) {
			return;
		}

		if (!(event.target instanceof Element)) {
			return;
		}

		if (event.target.closest(`[data-tabs-nav-mobile-more-menu]`)) {
			return;
		}

		if (event.target.closest(`#tabs-nav-mobile-more-trigger`)) {
			return;
		}

		isMoreMenuOpen = false;
	}

	/**
	 * Close the mobile `Mehr` menu with Escape.
	 * Example: keyboard users can dismiss the popup without tapping elsewhere.
	 */
	function handleDocumentKeydown(event: KeyboardEvent) {
		if (event.key !== `Escape`) {
			return;
		}

		isMoreMenuOpen = false;
	}

</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<nav
	aria-label="Hauptnavigation mobil"
	class="fixed inset-x-0 bottom-0 z-50 border-t border-base-300/80 bg-base-100 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] md:hidden"
>
	<ul class="grid grid-cols-5 px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
	>
		{#each getAppNavItems().filter(x => !x.isInMoreMenu) as tab (tab.href)}
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
						<i class={[icon, tab.label === `Erstellen` ? `size-6` : `size-6`]}></i>
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
						<i class={[icon, tab.label === `Erstellen` ? `size-6` : `size-6`]}></i>
						<span class="text-[0.7rem] font-medium">{tab.label}</span>
					</a>
				{/if}
			</li>
		{/each}
		<li class="relative">
			{#if isMoreMenuOpen}
				<div
					data-tabs-nav-mobile-more-menu
					class="absolute right-0 bottom-full mb-3 min-w-36 rounded-xl border border-base-300 bg-base-100 p-1 shadow-xl"
				>
					{#each getAppNavItems().filter(x => x.isInMoreMenu) as item (item.href)}
						{@const isActive = isActiveAppTab(pathname, item.href)}
						{@const icon = isActive ? item.iconActive : item.icon}
						{#if item.requireLogin && !userId}
							<button
								type="button"
								onclick={() => {
									isMoreMenuOpen = false;
									showLoginDialog();
								}}
								class={[
									`flex h-10 w-full items-center gap-2 rounded-lg px-3 pr-5 text-sm font-medium outline-hidden select-none transition-colors`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `text-base-content/75 hover:bg-primary/5 hover:text-primary-content`
								]}
							>
								<i class={[icon, `size-4`]}></i>
								<span>{item.label}</span>
							</button>
						{:else}
							<a
								href={resolve(item.href as `/${string}`)}
								aria-current={isActive ? `page` : undefined}
								onclick={() => {
									isMoreMenuOpen = false;
								}}
								class={[
									`flex h-10 items-center gap-2 rounded-lg px-3 pr-5 text-sm font-medium outline-hidden select-none transition-colors`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `text-base-content/75 hover:bg-primary/5 hover:text-primary-content`
								]}
							>
								<i class={[icon, `size-4`]}></i>
								<span>{item.label}</span>
							</a>
						{/if}
					{/each}
				</div>
			{/if}
			<button
				id="tabs-nav-mobile-more-trigger"
				type="button"
				aria-expanded={isMoreMenuOpen}
				aria-haspopup="menu"
				onclick={toggleMoreMenu}
				class="flex min-h-10 w-full flex-col items-center justify-center rounded-2xl transition-colors text-base-content/65"
			>
				<i class="size-6 icon-[ph--dots-three]"></i>
				<span class="text-[0.7rem] font-medium">Mehr</span>
			</button>
		</li>
	</ul>
</nav>
