<script lang="ts">
	import { page } from '$app/state';
	import { getAppTabs, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';
	import { resolve } from '$app/paths';

	let { ...rest } = $props();
	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
</script>

<nav class={['hidden md:block md:shrink-0 bg-base-200', rest.class]} aria-label="Hauptnavigation">
	<div class="flex w-3xl ">
		<a class="flex items-center gap-3" href={resolve('/')}>
			<img src="/logo.svg" alt="Blissbase" class="size-10" />
			<h2 class="text-xl font-brand text-primary-content">Blissbase</h2>
		</a>
		<div class="grow"></div>

		<ul class="flex flex-row gap-1">
			{#each getAppTabs() as tab (tab.href)}
				{@const icon = isActiveAppTab(pathname, tab.href) ? tab.iconActive : tab.icon}
				<li>
					<a
						href={tab.requireLogin && !userId ? '#' : tab.href}
						onclick={tab.requireLogin && !userId ? showLoginDialog : undefined}
						aria-current={isActiveAppTab(pathname, tab.href) ? `page` : undefined}
						class={[
							`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-colors justify-start`,
							isActiveAppTab(pathname, tab.href)
								? `bg-primary/20 text-primary-content `
								: `hover:text-primary-content hover:bg-primary/5 text-base-content/75`
						]}
					>
						<i class={[icon, `size-5 shrink-0`]}></i>
						<span>{tab.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</div>
</nav>
