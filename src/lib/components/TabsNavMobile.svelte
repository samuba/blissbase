<script lang="ts">
	import { page } from '$app/state';
	import { getAppTabs, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
</script>

<nav
	aria-label="Hauptnavigation mobil"
	class="fixed inset-x-0 bottom-0 z-50 border-t border-base-300/80 bg-base-100 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] md:hidden"
>
	<ul class="grid grid-cols-5 px-2 py-2"
	// pb-[calc(0.5rem+env(safe-area-inset-bottom))]
	>
		{#each getAppTabs() as tab (tab.href)}
			{@const icon = isActiveAppTab(pathname, tab.href) ? tab.iconActive : tab.icon}
			<li>
				<a
					href={tab.requireLogin && !userId ? '#' : tab.href}
					onclick={tab.requireLogin && !userId ? showLoginDialog : undefined}
					aria-current={isActiveAppTab(pathname, tab.href) ? `page` : undefined}
					class={[
						`flex min-h-10 flex-col items-center justify-center rounded-2xl  transition-colors`,
						isActiveAppTab(pathname, tab.href)
							? `text-primary-btn-border font-bold`
							: `text-base-content/65`
					]}
				>
					<i class={[icon, tab.label === `Erstellen` ? `size-6` : `size-6`]}></i>
					<span class="text-[0.7rem] font-medium">{tab.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
