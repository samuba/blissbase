<script lang="ts">
	import { page } from '$app/state';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import OfferingsNavHintBubble from '$lib/components/OfferingsNavHintBubble.svelte';
	import { offeringsNavHint } from '$lib/offeringsNavHint.svelte';
	import { routes } from '$lib/routes';
	import { showLoginDialog } from './LoginDialog.svelte';

	let { class: className, ...rest }: { class?: string; [key: string]: unknown } = $props();

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);
	const navItems = $derived(getAppNavItems());
</script>

<!-- when changing height of the nav we need to also change sticky-top position in LexicalEditor.svelte for non-mobile -->
<svelte:boundary>
	<nav
		class={['hidden md:flex md:shrink-0 w-full bg-base-200', className]}
		aria-label="Hauptnavigation"
		{...rest}
	>
		<div class="flex w-full min-w-0 items-center gap-3">
			<a class="flex shrink-0 items-center gap-3" href={routes.root()} data-testid="nav-home">
				<img src="/logo-90x90.png" alt="" class="size-10" data-testid="nav-logo" />
				<h2 class="font-brand text-primary-content text-xl">Blissbase</h2>
			</a>

			<div class="grow"></div>

			<ul class="flex shrink-0 flex-row gap-0.5">
				{#each navItems as tab (tab.href)}
					{@const isActive = isActiveAppTab(pathname, tab.href)}
					{@const icon = isActive ? tab.iconActive : tab.icon}
					<li class={[`relative`, tab.id === `offerings` && offeringsNavHint.show && `z-20`]}>
						{#if tab.requireLogin && !userId}
							<button
								type="button"
								onclick={showLoginDialog}
								data-testid={`nav-${tab.id}`}
								class={[
									`flex h-10 items-center justify-start gap-2 rounded-full px-3 text-sm font-medium transition-colors lg:px-4`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `hover:text-primary-content hover:bg-primary/5 text-base-content/75`,
								]}
							>
								<i class={[icon, `size-5 shrink-0`]}></i>
								<span>{tab.label}</span>
							</button>
						{:else}
							<a
								href={tab.href}
								data-testid={`nav-${tab.id}`}
								onclick={() => tab.id === `offerings` && offeringsNavHint.dismiss()}
								aria-current={isActive ? `page` : undefined}
								class={[
									`flex h-10 items-center justify-start gap-2 rounded-full px-3 text-sm font-medium transition-colors lg:px-4`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `hover:text-primary-content hover:bg-primary/5 text-base-content/75`,
								]}
							>
								<i class={[icon, `size-5 shrink-0`]}></i>
								<span>{tab.label}</span>
							</a>
						{/if}
						{#if tab.id === `offerings`}
							<OfferingsNavHintBubble placement="below" />
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</nav>

	{#snippet failed(error, reset)}
		<nav class={['hidden md:block md:shrink-0 w-full bg-base-200', className]} aria-label="Hauptnavigation">
			<div class="flex w-full items-center gap-3">
				<a class="flex items-center gap-3" href={routes.root()}>
					<img src="/logo-90x90.png" alt="" class="size-10" data-testid="nav-logo" />
					<h2 class="font-brand text-primary-content text-xl">Blissbase</h2>
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
