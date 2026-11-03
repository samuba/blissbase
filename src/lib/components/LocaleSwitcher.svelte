<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { localeStore } from '../../locales/localeStore.svelte';

	let { forceClose = false }: { forceClose?: boolean } = $props();

	function getOptions() {
		return [
			{ locale: `en` as const, label: /* @wc-include */ `Englisch` },
			{ locale: `de` as const, label: /* @wc-include */ `Deutsch` },
		];
	}

	const options = $derived(getOptions());
	// Prefer request-scoped page data on SSR to avoid the shared server localeStore race.
	const locale = $derived(page.data.locale ?? localeStore.locale);
	const currentLabel = $derived(
		options.find((option) => option.locale === locale)?.label ?? /* @wc-include */ `Englisch`,
	);

	let open = $state(false);

	$effect(() => {
		if (forceClose) open = false;
	});
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		type="button"
		data-testid="locale-switcher"
		class="link link-hover text-base-content/50 inline-flex items-center gap-1 text-xs leading-none"
	>
		<i class="icon-[ph--flag] size-3.5 shrink-0" aria-hidden="true"></i>
		{currentLabel}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class={[
				`card card-border bg-base-100 z-50 min-w-28 rounded-xl p-1 shadow-xl outline-hidden`,
				`data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`,
			]}
			side="top"
			align="start"
			sideOffset={8}
		>
			<DropdownMenu.RadioGroup
				value={locale}
				onValueChange={(value) => {
					if (value !== `en` && value !== `de`) return;
					open = false;
					localeStore.setLocale(value);
				}}
			>
				{#each options as option (option.locale)}
					<DropdownMenu.RadioItem
						value={option.locale}
						data-testid={`locale-${option.locale}`}
						class="data-highlighted:bg-base-200 flex h-9 w-full cursor-pointer items-center rounded-lg px-3 text-sm outline-hidden select-none"
					>
						{option.label}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
