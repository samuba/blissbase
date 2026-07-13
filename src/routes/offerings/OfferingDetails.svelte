<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import ImageDialog from "$lib/components/ImageDialog.svelte";
	import ProfileContactButtons from "$lib/components/ProfileContactButtons.svelte";
	import PublicProfileCard from "$lib/components/PublicProfileCard.svelte";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import { deleteOffering, listOffering, unlistOffering } from "$lib/rpc/offerings.remote";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { routes } from "$lib/routes";
	import { toast } from "svelte-sonner";

	let {
		offering,
		onManaged,
		editReturnTo,
		class: className,
	}: {
		offering: OfferingDetailsOffering;
		onManaged?: (action: OfferingManagementAction) => void | Promise<void>;
		editReturnTo?: string;
		class?: string;
	} = $props();

	let selectedImageIndex = $state(0);
	let imageLoadError = $state(false);
	let pendingManagementAction = $state<OfferingManagementAction | undefined>(undefined);
	const imageUrl = $derived.by(() => {
		const rawUrl = offering.imageUrls?.[selectedImageIndex] ?? ``;
		return imageLoadError ? (rawUrl.split(`https:`)?.[2] ?? ``) : rawUrl;
	});

	function selectImage(index: number) {
		selectedImageIndex = index;
		imageLoadError = false;
	}

	async function manageOffering(action: OfferingManagementAction) {
		if (pendingManagementAction) return;
		if (action === `delete` && !confirm(`Dieses Angebot dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;

		pendingManagementAction = action;
		try {
			if (action === `unlist`) {
				await unlistOffering({ offeringId: offering.id });
			} else if (action === `list`) {
				await listOffering({ offeringId: offering.id });
			} else {
				await deleteOffering({ offeringId: offering.id });
			}

			if (action === `delete`) {
				if (onManaged) {
					await invalidateAll();
					await onManaged(action);
				} else {
					await goto(routes.offeringsList());
				}
				return;
			}

			await invalidateAll();
			await onManaged?.(action);
		} catch {
			toast.error(managementErrorMessage(action));
		} finally {
			pendingManagementAction = undefined;
		}
	}

	function manageListingState() {
		void manageOffering(offering.listed ? `unlist` : `list`);
	}

	function managementErrorMessage(action: OfferingManagementAction) {
		if (action === `unlist`) return `Angebot konnte nicht deaktiviert werden.`;
		if (action === `list`) return `Angebot konnte nicht aktiviert werden.`;
		return `Angebot konnte nicht gelöscht werden.`;
	}

	type OfferingDetailsOffering = {
		id: number;
		slug: string | null;
		title: string;
		descriptionHtml: string;
		format: OfferingFormat;
		imageUrls?: string[];
		listed: boolean;
		canManage?: boolean;
		profile: {
			slug: string | null;
			displayName: string | null;
			bio: string;
			profileImageUrl: string;
			bannerImageUrl: string;
			socialLinks: PublicProfileSocialLinks;
			locationLabel?: string | null;
		};
	};

	type OfferingManagementAction = `list` | `unlist` | `delete`;
</script>

<article class={[className]}>
	{#if imageUrl}
		<ImageDialog
			imageUrls={offering.imageUrls ?? []}
			alt={offering.title}
			triggerProps={{ class: `w-full` }}
			bind:currentIndex={selectedImageIndex}
		>
			<div class="bg-cover bg-center" style="background-image: url({imageUrl})">
				<figure class="flex justify-center shadow-sm backdrop-blur-md backdrop-brightness-85">
					<img
						src={imageUrl}
						alt={offering.title}
						class="max-h-96 w-fit max-w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
						onerror={() => (imageLoadError = true)}
					/>
				</figure>
			</div>
		</ImageDialog>

		{#if (offering.imageUrls?.length ?? 0) > 1}
			<div class="mt-0.5 flex flex-wrap items-center justify-center gap-2">
				{#each offering.imageUrls! as thumbUrl, i (`${thumbUrl}-${i}`)}
					<button
						type="button"
						class={[
							`border-base-300 focus:ring-primary cursor-pointer rounded-md transition-all focus:ring-2 focus:outline-none`,
							i === selectedImageIndex ? `ring-primary ring-2` : ``,
						]}
						title={`Bild ${i + 1}`}
						onclick={() => selectImage(i)}
					>
						<img src={thumbUrl} alt={`thumbnail ${i + 1}`} class="size-18 rounded-md object-cover" />
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	<div class="flex flex-col gap-6 p-4 sm:p-6">
		<div class="flex flex-col gap-2">
			<div class="flex items-start justify-between gap-4">
				<h1 class="text-2xl leading-tight font-bold sm:text-3xl">{offering.title}</h1>
				<div class="flex shrink-0 items-center gap-2">
					<div class="h-10 w-16" aria-hidden="true"></div>
				</div>
			</div>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<span class="badge badge-ghost flex shrink-0 items-center gap-1.5 leading-none">
					{#if offering.format === `online`}
						<i class="icon-[ph--globe] size-4.5"></i>
						Online
					{:else if offering.format === `offline`}
						<i class="icon-[ph--users] size-4.5"></i>
						Vor Ort
					{:else}
						<i class="icon-[ph--users] size-4.5"></i>
						Vor Ort / Online
					{/if}
				</span>
				<div class="sm:grow"></div>

				{#if offering.canManage}
					<div class="join flex w-full items-center justify-center sm:w-auto">
						<button type="button" class="btn btn-sm join-item" onclick={manageListingState} disabled={Boolean(pendingManagementAction)}>
							{#if pendingManagementAction === `unlist` || pendingManagementAction === `list`}
								<span class="loading loading-spinner loading-xs"></span>
							{:else if offering.listed}
								<i class="icon-[ph--eye-slash] size-4"></i>
							{:else}
								<i class="icon-[ph--eye] size-4"></i>
							{/if}
							{offering.listed ? `Deaktivieren` : `Aktivieren`}
						</button>
						<button
							type="button"
							class="btn btn-sm join-item"
							onclick={() => void manageOffering(`delete`)}
							disabled={Boolean(pendingManagementAction)}
						>
							{#if pendingManagementAction === `delete`}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<i class="icon-[ph--trash] size-4"></i>
							{/if}
							Löschen
						</button>
						{#if offering.slug}
							<a
								href={pendingManagementAction ? "#" : routes.editOffering(offering.slug, { returnTo: editReturnTo })}
								class={["btn btn-sm join-item", pendingManagementAction && `btn-disabled`]}
							>
								<i class="icon-[ph--pencil-simple] size-4"></i>
								Bearbeiten
							</a>
						{/if}
					</div>
				{/if}
			</div>

			{#if offering.descriptionHtml?.trim()}
				<div class="prose max-w-none">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- offering descriptions are stored from the trusted Lexical form. -->
					{@html offering.descriptionHtml}
				</div>
			{/if}

			{#if offering.profile.slug && offering.profile.displayName}
				<PublicProfileCard profile={offering.profile}>
					<ProfileContactButtons socialLinks={offering.profile.socialLinks} class="sm:items-start" />
				</PublicProfileCard>
			{/if}
		</div>
	</div>
</article>

<style>
	:global(.prose a) {
		text-decoration: underline;
	}

	:global(.prose p) {
		margin-bottom: 0.3rem;
		margin-top: 0.3rem;
	}
</style>
