<script lang="ts">
	import type { RemoteFormField } from "$app/server";
	import { Combobox } from "bits-ui";
	import { tick } from "svelte";
	import { broadestTags } from "#lib/eventCategories.ts";

	let {
		field = $bindable(),
	}: {
		field: RemoteFormField<string[]>;
	} = $props();

	const sortedTags = broadestTags.filter((tag) => tag != null).sort((a, b) => a.label.localeCompare(b.label));
	type TagSlug = (typeof sortedTags)[number]["slug"];
	const tagsBySlug = new Map<string, (typeof sortedTags)[number]>(sortedTags.map((tag) => [tag.slug, tag]));

	let searchValue = $state(``);
	let open = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);
	let selectedSlugs = $derived((field.value() ?? []).filter((slug): slug is string => !!slug));

	function clearInput() {
		if (!inputRef) return;
		inputRef.value = ``;
		inputRef.dispatchEvent(new InputEvent(`input`, { bubbles: true, data: `` }));
	}

	function onSelectedSlugsChange(next: string[]) {
		field.set(next ?? []);
		open = false;
		// Bits-UI synchronously sets inputValue to the selected label inside toggleItem. Wait one tick so that runs first, then clear.
		tick().then(() => {
			searchValue = ``;
			clearInput();
		});
	}

	function removeTag(slug: string) {
		field.set(selectedSlugs.filter((selected) => selected !== slug));
	}

	const selectedSlugSet = $derived(new Set(selectedSlugs));

	const filteredTags = $derived.by(() => {
		const unselected = sortedTags.filter((tag) => !selectedSlugSet.has(tag.slug));
		if (searchValue === ``) return unselected;
		const search = searchValue.trim().toLowerCase();
		return unselected.filter((tag) => tag.slug.toLowerCase().includes(search) || tag.label.toLowerCase().includes(search));
	});
</script>

<Combobox.Root type="multiple" inputValue={searchValue} value={selectedSlugs} onValueChange={onSelectedSlugsChange} bind:open>
	<div class="relative">
		<Combobox.Input
			bind:ref={inputRef}
			oninput={(e) => (searchValue = e.currentTarget.value)}
			onclick={() => (open = true)}
			onkeydown={(e) => {
				if ((e.key === `ArrowDown` || e.key === `ArrowUp`) && !open) open = true;
			}}
			class="input w-full"
			placeholder="z.B. Meditation, Atemarbeit"
			aria-label="Suche nach Tags"
		/>
	</div>
	<Combobox.Portal>
		<Combobox.Content
			class="focus-override card card-border bg-base-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 h-96 max-h-(--bits-combobox-content-available-height) w-(--bits-combobox-anchor-width) min-w-(--bits-combobox-anchor-width) rounded-xl px-1  py-1 shadow-xl outline-hidden select-none data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1"
			sideOffset={10}
		>
			<Combobox.ScrollUpButton class="flex w-full items-center justify-center pt-1 pb-2">
				<i class="icon-[ph--caret-double-up] size-4"></i>
			</Combobox.ScrollUpButton>
			<Combobox.Viewport class="p-1">
				{#each filteredTags as tag (tag.slug)}
					<Combobox.Item
						class="data-highlighted:bg-base-200 flex h-10 w-full items-center rounded-lg py-5 pr-1.5 pl-5 text-sm capitalize outline-hidden select-none data-selected:font-bold"
						value={tag.slug}
						label={tag.label}
					>
						{tag.label}
					</Combobox.Item>
				{:else}
					<div class="flex items-center justify-center h-full">Keine Tags gefunden</div>
				{/each}
			</Combobox.Viewport>
			<Combobox.ScrollDownButton class="flex w-full items-center justify-center pt-2 pb-1">
				<i class="icon-[ph--caret-double-down] size-4"></i>
			</Combobox.ScrollDownButton>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

{#if selectedSlugs.length > 0}
	<div class="mt-1 flex flex-wrap gap-2">
		{#each selectedSlugs as slug (slug)}
			<input {...field.as("checkbox", slug as TagSlug)} checked class="hidden" />
			<div class="badge badge-ghost gap-1 pr-0 break-keep">
				{tagsBySlug.get(slug)?.label ?? slug}
				<button
					type="button"
					class="mx-0 flex cursor-pointer items-center justify-center pr-1.5"
					aria-label="Entfernen"
					onclick={() => removeTag(slug)}
				>
					<i class="icon-[ph--x] size-4"></i>
				</button>
			</div>
		{/each}
	</div>
{/if}
