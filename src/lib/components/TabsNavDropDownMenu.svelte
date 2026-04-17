<script lang="ts">
	import { page } from '$app/state';
	import { DropdownMenu } from 'bits-ui';
	import { getAppNavItems, isActiveAppTab } from '$lib/components/tabsNav';
	import { showLoginDialog } from './LoginDialog.svelte';
	import type { Snippet } from 'svelte';

	let {
		trigger,
		side = `bottom`,
		align = `end`
	}: {
		trigger: Snippet<[TriggerSnippetProps]>;
		side?: `top` | `right` | `bottom` | `left`;
		align?: `start` | `center` | `end`;
	} = $props();

	const userId = $derived(page.data.userId);
	const pathname = $derived(page.url.pathname);

	/** Bits UI trigger props — spread onto the trigger button/link. */
	type TriggerSnippetProps = { props: Record<string, unknown> };
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{side}
			{align}
			sideOffset={10}
			preventScroll={false}
			class="card card-border bg-base-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-36 rounded-xl px-1 py-1 shadow-xl outline-hidden select-none data-[side=bottom]:-translate-y-2 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1"
		>
			{#each getAppNavItems().filter(x => x.isInMoreMenu) as item (item.href)}
				{@const isActive = isActiveAppTab(pathname, item.href)}
				{@const icon = isActive ? item.iconActive : item.icon}
				<DropdownMenu.Item>
					{#snippet child(args)}
						{#if item.requireLogin && !userId}
							<button
								type="button"
								{...args.props}
								onclick={showLoginDialog}
								class={[
									`flex h-10 w-full items-center gap-2 rounded-lg px-3 pr-5 text-sm font-medium outline-hidden select-none transition-colors`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `text-base-content/75 data-highlighted:bg-primary/5 data-highlighted:text-primary-content`
								]}
							>
								<i class={[icon, `size-4`]}></i>
								<span>{item.label}</span>
							</button>
						{:else}
							<a
								{...args.props}
								href={item.href}
								aria-current={isActive ? `page` : undefined}
								class={[
									`flex h-10 items-center gap-2 rounded-lg px-3 pr-5 text-sm font-medium outline-hidden select-none transition-colors`,
									isActive
										? `bg-primary/20 text-primary-content`
										: `text-base-content/75 data-highlighted:bg-primary/5 data-highlighted:text-primary-content`
								]}
							>
								<i class={[icon, `size-4`]}></i>
								<span>{item.label}</span>
							</a>
						{/if}
					{/snippet}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
