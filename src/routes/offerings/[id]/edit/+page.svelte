<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import { deleteOffering, listOffering, unlistOffering, updateOffering } from "$lib/rpc/offerings.remote";
	import { routes, safeReturnToPath } from "$lib/routes";
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
	const fallbackReturnHref = routes.offeringsList();
	let returnHref = $derived(
		safeReturnToPath({
			returnTo: page.url.searchParams.get(`returnTo`),
			fallback: fallbackReturnHref,
			origin: page.url.origin,
		}),
	);

	$effect(() => {
		if (initializedFormOfferingId === offering.id) return;
		updateOffering.fields.set(editFormValues);
		format = editFormValues.format;
		initializedFormOfferingId = offering.id;
	});

	function handleCancel() {
		void goto(returnHref);
	}

	async function handleDeleteOffering() {
		if (!confirm(`Dieses Angebot dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;

		try {
			isDeletingOffering = true;
			await deleteOffering({ offeringId: offering.id });
			await goto(routes.offeringsList());
		} catch (error) {
			console.error(`Failed to delete offering:`, error);
			toast.error(managementErrorMessage(`delete`));
		} finally {
			isDeletingOffering = false;
		}
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

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="text-2xl font-bold">Angebot bearbeiten</h1>
				</div>
				<a href={returnHref} class="btn btn-ghost btn-sm">
					<i class="icon-[ph--arrow-left] size-4"></i>
					Zurück
				</a>
			</div>

			{#if initializedFormOfferingId === offering.id}
				<OfferingForm
					remoteForm={updateOffering}
					initialExistingImageUrls={editFormValues.existingImageUrls}
					returnTo={returnHref}
					bind:format
					onImageBusyChange={(busy) => (imageBusy = busy)}
				/>
			{/if}

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
				<div class="flex flex-row items-center join w-full sm:w-auto ">
					<button type="button" onclick={handleDeleteOffering} disabled={actionsDisabled} class="btn join-item disabled:text-warning-content grow">
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
