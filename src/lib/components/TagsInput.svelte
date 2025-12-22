<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { getTags } from './TagSelection.remote';
	import { localeStore } from '../../locales/localeStore.svelte';

	let { selectedTags = $bindable([]) }: { selectedTags: string[] } = $props();
	const { allTags: tags } = await getTags();

	let searchValue = $state('');
	let open = $state(false);

	const filteredTags = $derived(
		searchValue === ''
			? tags
			: tags.filter((x) => {
					const search = searchValue.trim().toLowerCase();
					return (
						x.slug.toLowerCase().includes(search) ||
						x.en?.toLowerCase().includes(search) ||
						x.de?.toLowerCase().includes(search) ||
						x.nl?.toLowerCase().includes(search)
					);
			  })
	);
</script>

<Combobox.Root
	type="multiple"
	onOpenChange={(o) => {
		if (!o) searchValue = '';
	}}
	bind:value={selectedTags}
	bind:open
>
	<div class="relative">
		<i
			class="icon-[ph--tag] text-muted-foreground absolute start-3 top-1/2 size-6 -translate-y-1/2"
		/>
		<Combobox.Input
			oninput={(e) => (searchValue = e.currentTarget.value)}
			onclick={() => (open = true)}
			class="input w-full"
			placeholder="Suche nach einem Tag"
			aria-label="Suche nach einem Tag"
		/>
		<Combobox.Trigger class="absolute end-3 top-1/2 size-6 -translate-y-1/2 touch-none">
			<i class="icon-[ph--caret-up-down] text-muted-foreground size-6" />
		</Combobox.Trigger>
	</div>
	<Combobox.Portal>
		<Combobox.Content
			class="focus-override card card-border bg-base-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 h-96 max-h-[var(--bits-combobox-content-available-height)] w-[var(--bits-combobox-anchor-width)] min-w-[var(--bits-combobox-anchor-width)] rounded-xl px-1  py-3 shadow-xl outline-hidden select-none data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1"
			sideOffset={10}
		>
			<Combobox.ScrollUpButton class="flex w-full items-center justify-center py-1">
				<i class="icon-[ph--caret-double-up] size-3" />
			</Combobox.ScrollUpButton>
			<Combobox.Viewport class="p-1">
				{#each filteredTags as tag (tag.id)}
					{@const label = tag[localeStore.locale] ?? tag.slug}
					<Combobox.Item
						class="rounded-button data-highlighted:bg-base-200 flex h-10 w-full items-center py-5 pr-1.5 pl-5 text-sm capitalize outline-hidden select-none data-selected:font-bold"
						value={label}
						label={label}
					>
						{#snippet children({ selected })}
							{label}
							{#if selected}
								<div class="ml-auto">
									<i class="icon-[ph--check] size-5" />
								</div>
							{/if}
						{/snippet}
					</Combobox.Item>
				{:else}
					<span class="block px-5 py-2 text-sm text-muted-foreground"> Keine Tags gefunden</span>
				{/each}
			</Combobox.Viewport>
			<Combobox.ScrollDownButton class="flex w-full items-center justify-center py-1">
				<i class="icon-[ph--caret-double-down] size-3" />
			</Combobox.ScrollDownButton>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
