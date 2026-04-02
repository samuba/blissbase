<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';
	import TabsNavDropDownMenu from './TabsNavDropDownMenu.svelte';

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
			{#each getAppNavItems().filter(x => !x.isInMoreMenu) as tab (tab.href)}
				{@const isActive = isActiveAppTab(pathname, tab.href)}
				{@const icon = isActive ? tab.iconActive : tab.icon}
				<li>
					{#if tab.requireLogin && !userId}
						<button
							type="button"
							onclick={showLoginDialog}
							class={[
								`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-colors justify-start`,
								isActive
									? `bg-primary/20 text-primary-content `
									: `hover:text-primary-content hover:bg-primary/5 text-base-content/75`
							]}
						>
							<i class={[icon, `size-5 shrink-0`]}></i>
							<span>{tab.label}</span>
						</button>
					{:else}
						<a
							href={tab.href}
							aria-current={isActive ? `page` : undefined}
							class={[
								`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-colors justify-start`,
								isActive
									? `bg-primary/20 text-primary-content `
									: `hover:text-primary-content hover:bg-primary/5 text-base-content/75`
							]}
						>
							<i class={[icon, `size-5 shrink-0`]}></i>
							<span>{tab.label}</span>
						</a>
					{/if}
				</li>
			{/each}
			<li>
				<TabsNavDropDownMenu>
					{#snippet trigger({ props })}
						<button
							type="button"
							{...props}
							class="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-colors justify-start text-base-content/75 hover:text-primary-content hover:bg-primary/5"
						>
							<i class="icon-[ph--dots-three] size-5 shrink-0"></i>
							<span>Mehr</span>
						</button>
					{/snippet}
				</TabsNavDropDownMenu>
			</li>
		</ul>
	</div>
</nav>
