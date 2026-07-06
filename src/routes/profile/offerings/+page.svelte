<script lang="ts">
	import { page } from "$app/state";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import LocationAutocompleteInput from "$lib/components/LocationAutocompleteInput.svelte";
	import OfferingCard from "$lib/components/OfferingCard.svelte";
	import { profileLocationFormSchema } from "$lib/rpc/profile.common";
	import { getMyOfferings, updateProfileLocation } from "$lib/rpc/offerings.remote";
	import { getMyPublicProfile } from "$lib/rpc/profile.remote";
	import { routes } from "$lib/routes";
	import { showOfferingDetailsDialog } from "../../offerings/OfferingDetailsDialog.svelte";

	const profile = $state(await getMyPublicProfile());
	const offerings = $derived(await getMyOfferings());
	const activeOfferings = $derived(offerings.filter((offering) => offering.listed));
	const inactiveOfferings = $derived(offerings.filter((offering) => !offering.listed));
	const locationPreflight = $derived(updateProfileLocation.preflight(profileLocationFormSchema));

	let selectedTab = $state<`active` | `inactive`>(`active`);

	function newOfferingHref() {
		return routes.newOffering({ returnTo: routes.currentPath(page.url) });
	}

	function openOfferingDetails(offering: (typeof offerings)[number]) {
		showOfferingDetailsDialog(offering, { returnTo: routes.currentPath(page.url) });
	}
</script>

<svelte:head>
	<title>Meine Angebote | Blissbase</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-xl font-bold">Meine Angebote</h1>
	</div>
	<p class="text-base-content/60 text-sm leading-relaxed">
		Verwalte deine Angebote. Aktivierte Angebote sind für andere Nutzer auf der
		<a href={routes.offeringsList()} class="link">Angebote-Seite</a> sichtbar.
	</p>

	<form
		{...locationPreflight}
		class="card bg-base-100 mt-4 shadow"
	>
		<div class="card-body gap-3">
			<fieldset class="fieldset">
				<legend class="fieldset-legend peer-aria-invalid:text-red-600">
					Standort für deine Angebote
				</legend>
				<p class="text-base-content/70 mb-1 text-sm leading-relaxed">
					Deine Angebote werden in der Nähe dieses Orts angezeigt.
					Ohne Standort sind nur Online-Angebote auffindbar.
				</p>
				<LocationAutocompleteInput
					inputId="offeringsProfileLocationInput"
					initialLabel={profile.locationLabel}
					initialLat={profile.latitude}
					initialLng={profile.longitude}
					locationLabelField={updateProfileLocation.fields.locationLabel}
					latitudeField={updateProfileLocation.fields.latitude}
					longitudeField={updateProfileLocation.fields.longitude}
				/>
				<FormFieldIssues field={updateProfileLocation.fields.locationLabel} />
				<FormFieldIssues field={updateProfileLocation.fields.latitude} />
				<FormFieldIssues field={updateProfileLocation.fields.longitude} />
			</fieldset>

			<div class="flex justify-end">
				<button
					type="submit"
					class="btn btn-primary btn-sm"
					disabled={updateProfileLocation.pending > 0}
				>
					{#if updateProfileLocation.pending > 0}
						<span class="loading loading-spinner loading-sm"></span>
						Speichern…
					{:else}
						Standort speichern
					{/if}
				</button>
			</div>
		</div>
	</form>

	<div class=" my-4">
		<a href={newOfferingHref()} class="btn btn-primary w-full sm:w-auto">
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
					<OfferingCard {offering} showAuthor={false} onclick={() => openOfferingDetails(offering)} />
				{/each}
			</div>
		{:else}
			<div class="text-base-content/60 mt-12 flex flex-col items-center gap-3 text-center">
				<span>Du hast keine aktiven Angebote.</span>
				<a href={newOfferingHref()} class="btn btn-primary btn-sm w-fit">Angebot erstellen</a>
			</div>
		{/if}
	</div>

	<div class={[selectedTab !== `inactive` && `hidden`]}>
		{#if inactiveOfferings.length}
			<div class="mt-4 flex w-full flex-col gap-4">
				{#each inactiveOfferings as offering (offering.id)}
					<OfferingCard {offering} showAuthor={false} onclick={() => openOfferingDetails(offering)} />
				{/each}
			</div>
		{:else}
			<div class="text-base-content/60 mt-12 text-center">Du hast keine deaktivierten Angebote.</div>
		{/if}
	</div>
</div>

