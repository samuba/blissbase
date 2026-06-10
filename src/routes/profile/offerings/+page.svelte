<script lang="ts">
	import OfferingCard from "$lib/components/OfferingCard.svelte";
	import { getMyOfferings } from "$lib/rpc/offerings.remote";
	import { routes } from "$lib/routes";
	import OfferingDetailsDialog, { showOfferingDetailsDialog } from "../../offerings/OfferingDetailsDialog.svelte";

	const offerings = $derived(await getMyOfferings());
	const activeOfferings = $derived(offerings.filter((offering) => offering.listed));
	const inactiveOfferings = $derived(offerings.filter((offering) => !offering.listed));

	let selectedTab = $state<`active` | `inactive`>(`active`);
</script>

<svelte:head>
	<title>Meine Angebote | Blissbase</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-xl font-bold">Meine Angebote</h1>
	</div>
	<p class="text-base-content/60 text-sm leading-relaxed">
		Verwalte deine Angebote. Aktivierte Angebote sind für andere Nutzer in auf der 
		<a href={routes.offeringsList()} class="link">Angebote Seite</a> sichtbar.
	</p>

	<div class=" my-4">
		<a href={routes.newOffering()} class="btn btn-primary w-full sm:w-auto">
			<i class="icon-[ph--plus] size-4"></i>
			Angebot erstellen
		</a>
	</div>

	<div role="tablist" class="tabs tabs-box bg-base-300 mt-3 flex flex-row justify-center">
		<button
			role="tab"
			class={[`tab flex-1 basis-0`, selectedTab === `active` && `tab-active`]}
			onclick={() => (selectedTab = `active`)}
		>
			<i class="icon-[ph--eye] size-4 mr-2"></i>
			Aktiv
		</button>

		<button
			role="tab"
			class={[`tab flex-1 basis-0`, selectedTab === `inactive` && `tab-active`]}
			onclick={() => (selectedTab = `inactive`)}
		>
			<i class="icon-[ph--eye-slash] size-4 mr-2"></i>
			Deaktiviert
		</button>
	</div>

	<div class={[selectedTab !== `active` && `hidden`]}>
		{#if activeOfferings.length}
			<div class="mt-4 flex w-full flex-col gap-4">
				{#each activeOfferings as offering (offering.id)}
					<OfferingCard {offering} showAuthor={false} onclick={() => showOfferingDetailsDialog(offering)} />
				{/each}
			</div>
		{:else}
			<div class="text-base-content/60 mt-12 flex flex-col items-center gap-3 text-center">
				<span>Du hast keine aktiven Angebote.</span>
				<a href={routes.newOffering()} class="btn btn-primary btn-sm w-fit">Angebot erstellen</a>
			</div>
		{/if}
	</div>

	<div class={[selectedTab !== `inactive` && `hidden`]}>
		{#if inactiveOfferings.length}
			<div class="mt-4 flex w-full flex-col gap-4">
				{#each inactiveOfferings as offering (offering.id)}
					<OfferingCard {offering} showAuthor={false} onclick={() => showOfferingDetailsDialog(offering)} />
				{/each}
			</div>
		{:else}
			<div class="text-base-content/60 mt-12 text-center">Du hast keine deaktivierten Angebote.</div>
		{/if}
	</div>
</div>

<OfferingDetailsDialog />
