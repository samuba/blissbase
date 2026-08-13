<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import { showFlashToast } from "$lib/flashToast.svelte";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import { deleteOffering, listOffering, unlistOffering, updateOffering } from "$lib/rpc/offerings.remote";
	import {
		parseOfferingDetailsSlugFromUrl,
		routes,
		safeReturnToPath,
		takeOfferingSlugQuery,
	} from "$lib/routes";
	import { UnsavedChangesGuard } from "$lib/unsavedChangesGuard.svelte";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let offering = $derived(data.offering);
	let editFormValues = $derived(data.editFormValues);
	let initializedFormOfferingId = $state<number | null>(null);

	let format = $state<OfferingFormat>(`offline`);
	let imageBusy = $state(false);
	let isDeletingOffering = $state(false);
	let isChangingListing = $state(false);
	let isSubmitting = $derived(updateOffering.pending > 0);
	let actionsDisabled = $derived(isSubmitting || isDeletingOffering || isChangingListing || imageBusy);
	const fallbackReturnHref = $derived(
		offering.slug ? routes.offeringDetails(offering.slug) : routes.offeringsList(),
	);
	let returnHref = $derived(
		safeReturnToPath({
			returnTo: page.url.searchParams.get(`returnTo`),
			fallback: fallbackReturnHref,
			origin: page.url.origin,
		}),
	);
	const deleteReturnHref = $derived(getDeleteReturnHref(page.url.searchParams.get(`returnTo`)));

	const unsaved = new UnsavedChangesGuard();

	$effect(() => {
		if (initializedFormOfferingId === offering.id) return;
		updateOffering.fields.set(editFormValues);
		format = editFormValues.format;
		initializedFormOfferingId = offering.id;
	});

	async function handleSaveSuccess() {
		unsaved.clear();
		showFlashToast(`offeringUpdated`);
		await goto(returnHref, { replaceState: true });
	}

	function handleCancel() {
		void goto(returnHref, { replaceState: true });
	}

	async function handleDeleteOffering() {
		if (!confirm(`Dieses Angebot dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;

		try {
			isDeletingOffering = true;
			await deleteOffering({ offeringId: offering.id });
			unsaved.clear();
			await goto(deleteReturnHref, { replaceState: true });
		} catch (error) {
			console.error(`Failed to delete offering:`, error);
			toast.error(managementErrorMessage(`delete`));
		} finally {
			isDeletingOffering = false;
		}
	}

	function getDeleteReturnHref(returnTo: string | null) {
		const path = safeReturnToPath({
			returnTo,
			fallback: routes.offeringsList(),
			origin: page.url.origin,
		});
		const url = new URL(path, page.url.origin);
		takeOfferingSlugQuery(url);
		if (parseOfferingDetailsSlugFromUrl(url)) return routes.offeringsList();
		return routes.currentPath(url);
	}

	async function handleToggleListing() {
		if (isChangingListing) return;

		const action = offering.listed ? `unlist` : `list`;

		try {
			isChangingListing = true;
			if (offering.listed) {
				await unlistOffering({ offeringId: offering.id });
			} else {
				await listOffering({ offeringId: offering.id });
			}

			await invalidateAll();
		} catch (error) {
			console.error(`Failed to update offering listing state:`, error);
			toast.error(managementErrorMessage(action));
		} finally {
			isChangingListing = false;
		}
	}

	function managementErrorMessage(action: OfferingManagementAction) {
		if (action === `unlist`) return `Angebot konnte nicht deaktiviert werden.`;
		if (action === `list`) return `Angebot konnte nicht aktiviert werden.`;
		return `Angebot konnte nicht gelöscht werden.`;
	}

	type OfferingManagementAction = `list` | `unlist` | `delete`;
</script>

<svelte:head>
	<title>Angebot bearbeiten | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<h1 class="text-xl sm:text-2xl font-bold">Angebot bearbeiten</h1>

			{#if initializedFormOfferingId === offering.id}
				<OfferingForm
					remoteForm={updateOffering}
					initialExistingImageUrls={editFormValues.existingImageUrls}
					returnTo={returnHref}
					bind:format
					onDirty={unsaved.markDirty}
					onImageBusyChange={(busy) => (imageBusy = busy)}
					onSuccess={handleSaveSuccess}
				/>
			{/if}

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
				<div class="flex flex-row items-center join w-full sm:w-auto ">
					<button type="button" onclick={handleDeleteOffering} disabled={actionsDisabled} class="btn join-item grow">
						{#if isDeletingOffering}
							<span class="loading loading-spinner loading-sm"></span>
							Lösche…
						{:else}
							<i class="icon-[ph--trash] mr-1 size-4"></i>
							Löschen
						{/if}
					</button>
					<button type="button" onclick={handleToggleListing} disabled={actionsDisabled} class="btn join-item grow">
						{#if isChangingListing}
							<span class="loading loading-spinner loading-sm"></span>
							{offering.listed ? `Deaktiviere…` : `Aktiviere…`}
						{:else if offering.listed}
							<i class="icon-[ph--eye-slash] mr-1 size-4"></i>
							Deaktivieren
						{:else}
							<i class="icon-[ph--eye] mr-1 size-4"></i>
							Aktivieren
						{/if}
					</button>
				</div>

				<div class="grow"></div>

				<button type="button" onclick={handleCancel} class="btn " disabled={actionsDisabled}>Abbrechen</button>

				<button type="submit" form="offering-form" class="btn btn-primary " disabled={actionsDisabled}>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-sm"></span>
						Speichere…
					{:else if imageBusy}
						<span class="loading loading-spinner loading-sm"></span>
						Bilder werden hochgeladen…
					{:else}
						Speichern
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
