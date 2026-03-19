<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { tick } from 'svelte';
	import { getTags } from '$lib/rpc/TagSelection.remote';
	import { localeStore } from '../../locales/localeStore.svelte';
	import type { RemoteFormField } from '@sveltejs/kit';

	let { 
		field = $bindable()
	}: {  field: RemoteFormField<string[]> } = $props();
	
	const { allTags } = await getTags();
	allTags.sort((a, b) => a?.[localeStore.locale]?.localeCompare(b?.[localeStore.locale] ?? '') ?? 0);

	let searchValue = $state('');
	let open = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);
	let selectedTagIds = $state(
		allTags.filter((x) => field.value()?.includes(x.id.toString())).map((t) => t.id.toString())
	);

	function clearInput() {
		if (!inputRef) return;
		inputRef.value = ``;
		inputRef.dispatchEvent(new InputEvent(`input`, { bubbles: true, data: `` }));
	}

	function onSearchValueChange() {
		open = false;
		// Bits-UI synchronously sets inputValue to the selected label inside toggleItem. Wait one tick so that runs first, then clear.
		tick().then(() => {
			searchValue = '';
			clearInput();
		});
	}

	const selectedTagIdSet = $derived(new Set(selectedTagIds));

	const filteredTags = $derived.by(() => {
		const unselected = allTags.filter((x) => !selectedTagIdSet.has(x.id.toString()));
		if (searchValue === '') return unselected;
		const search = searchValue.trim().toLowerCase();
		return unselected.filter((x) =>
			x.slug.toLowerCase().includes(search) ||
			x.en?.toLowerCase().includes(search) ||
			x.de?.toLowerCase().includes(search) ||
			x.nl?.toLowerCase().includes(search)
		);
	});
</script>

<Combobox.Root
	type="multiple"
	inputValue={searchValue}
	onValueChange={onSearchValueChange}
	bind:value={selectedTagIds}
	bind:open
>
	<div class="relative">
		<Combobox.Input
			bind:ref={inputRef}
			oninput={(e) => (searchValue = e.currentTarget.value)}
			onclick={() => (open = true)}
			onkeydown={(e) => {
				if ((e.key === `ArrowDown` || e.key === `ArrowUp`) && !open) open = true;
			}}
			class="w-full input"
			placeholder="Suche nach Tags"
			aria-label="Suche nach Tags"
		/>
	</div>
	<Combobox.Portal>
		<Combobox.Content
			class="focus-override card card-border bg-base-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 h-96 max-h-(--bits-combobox-content-available-height) w-(--bits-combobox-anchor-width) min-w-(--bits-combobox-anchor-width) rounded-xl px-1  py-1 shadow-xl outline-hidden select-none data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1"
			sideOffset={10}
		>
			<Combobox.ScrollUpButton class="flex w-full items-center justify-center pt-1 pb-2">
				<i class="icon-[ph--caret-double-up] size-4" />
			</Combobox.ScrollUpButton>
			<Combobox.Viewport class="p-1">
				{#each filteredTags as tag (tag.id)}
					{@const label = tag[localeStore.locale] ?? tag.slug}
					<Combobox.Item
						class="rounded-lg data-highlighted:bg-base-200 flex h-10 w-full items-center py-5 pr-1.5 pl-5 text-sm capitalize outline-hidden select-none data-selected:font-bold"
						value={tag.id.toString()}
						label={label}
					>
						{label}
					</Combobox.Item>
				{:else}
					<div class="flex items-center justify-center h-full"> Keine Tags gefunden</div>
				{/each}
			</Combobox.Viewport>
			<Combobox.ScrollDownButton class="flex w-full items-center justify-center pb-1 pt-2">
				<i class="icon-[ph--caret-double-down] size-4" />
			</Combobox.ScrollDownButton>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

{#if selectedTagIds.length > 0}
	<div class="flex flex-wrap gap-2 mt-1">
		{#each selectedTagIds as tagId (tagId)}
			<input {...field.as('checkbox', tagId)} checked class="hidden" />
			<div class="badge badge-ghost break-keep pr-0 gap-1">
				{allTags.find((t) => t.id.toString() === tagId)?.[localeStore.locale] ?? tagId}
				<button
					type="button"
					class="cursor-pointer mx-0 pr-1.5 flex items-center justify-center"
					aria-label="Entfernen"
					onclick={() => selectedTagIds = selectedTagIds.filter((t) => t !== tagId)}
				>
					<i class="icon-[ph--x] size-4"></i>
				</button>
			</div>
		{/each}
	</div>
{/if}