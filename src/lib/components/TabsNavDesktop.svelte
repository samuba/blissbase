<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';

	let { ...rest } = $props();
	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
	const navItems = $derived(getAppNavItems());
</script>

<!-- when changing height of the nav we need to also change sticky-top position in LexicalEditor.svelte for non-mobile -->
<svelte:boundary>
	<nav class={['hidden md:flex justify-center md:shrink-0 bg-base-200', rest.class]} aria-label="Hauptnavigation">
		<div class="flex w-2xl ">
			<a class="flex items-center gap-3" href={resolve('/')} data-testid="nav-home">
				<img src="/logo-90x90.png" alt="" class="size-10" data-testid="nav-logo" />
				<h2 class="text-xl font-brand text-primary-content">Blissbase</h2>
			</a>
			<div class="grow"></div>

			<ul class="flex flex-row gap-1">
				{#each navItems as tab (tab.href)}
					{@const isActive = isActiveAppTab(pathname, tab.href)}
					{@const icon = isActive ? tab.iconActive : tab.icon}
					<li>
						{#if tab.requireLogin && !userId}
							<button
								type="button"
								onclick={showLoginDialog}
								data-testid={`nav-${tab.id}`}
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
								data-testid={`nav-${tab.id}`}
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
			</ul>
		</div>
	</nav>

	{#snippet failed(error, reset)}
		<nav class={['hidden md:block md:shrink-0 bg-base-200', rest.class]} aria-label="Hauptnavigation">
			<div class="flex w-3xl items-center gap-3">
				<a class="flex items-center gap-3" href={resolve('/')}>
					<img src="/logo-90x90.png" alt="" class="size-10" data-testid="nav-logo" />
					<h2 class="text-xl font-brand text-primary-content">Blissbase</h2>
				</a>
				<div class="grow"></div>
				<button
					type="button"
					onclick={reset}
					class="btn btn-ghost btn-sm text-error"
					title={error instanceof Error ? error.message : String(error)}
				>
					<i class="icon-[ph--warning-circle] size-4 shrink-0"></i>
					Navigation erneut laden
				</button>
			</div>
		</nav>
	{/snippet}
</svelte:boundary>
