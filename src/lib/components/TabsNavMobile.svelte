<script lang="ts">
	import { page } from '$app/state';
	import { getAppTabs, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';
	import TabsNavDropDownMenu from './TabsNavDropDownMenu.svelte';

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
</script>

<nav
	aria-label="Hauptnavigation mobil"
	class="fixed inset-x-0 bottom-0 z-50 border-t border-base-300/80 bg-base-100 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] md:hidden"
>
	<ul class="grid grid-cols-5 px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
	>
		{#each getAppTabs() as tab (tab.href)}
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
		<li>
			<TabsNavDropDownMenu side="top" align="center">
				{#snippet trigger({ props })}
					<button
						type="button"
						{...props}
						class="flex min-h-10 w-full flex-col items-center justify-center rounded-2xl transition-colors text-base-content/65"
					>
						<i class="size-6 icon-[ph--dots-three]"></i>
						<span class="text-[0.7rem] font-medium">Mehr</span>
					</button>
				{/snippet}
			</TabsNavDropDownMenu>
		</li>
	</ul>
</nav>
