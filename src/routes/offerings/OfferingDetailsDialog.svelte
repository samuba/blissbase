<script lang="ts" module>
	import { invalidateAll, pushState, replaceState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";

	let offering = $state<Offering | undefined>(undefined);
	let open = $state(false);
	let closeBehavior = $state<CloseBehavior>(`back`);
	let pendingManagementAction = $state<OfferingManagementAction | undefined>(undefined);

	export function showOfferingDetailsDialog(
		offeringToShow: Offering,
		args: { currentHistoryEntry?: boolean; initialDeepLink?: boolean } = {},
	) {
		offering = offeringToShow;
		open = true;
		closeBehavior = args.initialDeepLink ? `remove-query` : `back`;
		selectedImageIndex = 0;
		imageLoadError = false;
		pendingManagementAction = undefined;

		const nextUrl = currentUrlWithOffering(offeringToShow.id);
		const nextState = { selectedOfferingId: offeringToShow.id } as App.PageState;
		if (args.currentHistoryEntry || args.initialDeepLink) {
			replaceState(resolve(nextUrl as ResolvablePath), nextState);
			return;
		}

		pushState(resolve(nextUrl as ResolvablePath), nextState);
	}

	function currentUrlWithOffering(offeringId: number) {
		const url = new URL(window.location.href);
		url.searchParams.set(`offering`, offeringId.toString());
		return relativeUrl(url);
	}

	function currentUrlWithoutOffering() {
		const url = new URL(window.location.href);
		url.searchParams.delete(`offering`);
		return relativeUrl(url);
	}

	function relativeUrl(url: URL) {
		return `${url.pathname}${url.search}${url.hash}`;
	}

	type Offering = {
		id: number;
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
			place?: { name: string; slug: string } | null;
		};
	};

	type CloseBehavior = `back` | `remove-query`;
	type OfferingManagementAction = `list` | `unlist` | `delete`;
	type ResolvablePath = `/${string}` & {};

	let selectedImageIndex = $state(0);
	let imageLoadError = $state(false);
</script>

<script lang="ts">
	import { browser } from "$app/environment";
	import { page } from "$app/state";
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from "$lib/common";
	import ImageDialog from "$lib/components/ImageDialog.svelte";
	import ProfileContactButtons from "$lib/components/ProfileContactButtons.svelte";
	import PublicProfileCard from "$lib/components/PublicProfileCard.svelte";
	import { Dialog } from "$lib/components/dialog";
	import { deleteOffering, listOffering, unlistOffering } from "$lib/rpc/offerings.remote";
	import { routes } from "$lib/routes";
	import { toast } from "svelte-sonner";

	const selectedOfferingId = $derived(
		(page.state as App.PageState & { selectedOfferingId?: number }).selectedOfferingId ??
			Number(page.url.searchParams.get(`offering`) ?? 0),
	);
	const imageUrl = $derived.by(() => {
		const rawUrl = offering?.imageUrls?.[selectedImageIndex] ?? ``;
		return imageLoadError ? (rawUrl.split(`https:`)?.[2] ?? ``) : rawUrl;
	});

	$effect(() => {
		if (!selectedOfferingId) {
			closeGracefully();
		}
	});

	function handleClose() {
		if (!browser) return;
		if (closeBehavior === `remove-query`) {
			closeGracefully();
			replaceState(resolve(currentUrlWithoutOffering() as ResolvablePath), {});
			return;
		}

		closeGracefully();
		history.back();
	}

	function closeGracefully() {
		open = false;
		setTimeout(() => {
			offering = undefined;
		}, 200);
	}

	function onOpenChange(shouldOpen: boolean) {
		if (shouldOpen) return;
		handleClose();
	}

	function selectImage(index: number) {
		selectedImageIndex = index;
		imageLoadError = false;
	}

	async function manageOffering(action: OfferingManagementAction) {
		if (!offering || pendingManagementAction) return;
		if (action === `delete` && !confirm(`Dieses Angebot dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;

		pendingManagementAction = action;
		try {
			if (action === `unlist`) {
				await unlistOffering({ offeringId: offering.id });
				toast.success(`Angebot wurde deaktiviert`, { description: `Du kannst es in deinem Profil wieder aktivieren.` });
			} else if (action === `list`) {
				await listOffering({ offeringId: offering.id });
				toast.success(`Angebot wurde aktiviert`, { description: `Es ist jetzt für andere Nutzer sichtbar.` });
			} else {
				await deleteOffering({ offeringId: offering.id });
				toast.success(`Angebot wurde gelöscht.`);
			}

			await invalidateAll();
			handleClose();
		} catch {
			toast.error(managementErrorMessage(action));
		} finally {
			pendingManagementAction = undefined;
		}
	}

	function manageListingState() {
		if (!offering) return;
		void manageOffering(offering.listed ? `unlist` : `list`);
	}

	function managementErrorMessage(action: OfferingManagementAction) {
		if (action === `unlist`) return `Angebot konnte nicht deaktiviert werden.`;
		if (action === `list`) return `Angebot konnte nicht aktiviert werden.`;
		return `Angebot konnte nicht gelöscht werden.`;
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class={[`fixed inset-0 z-50 bg-stone-800/90 transition-opacity`, dialogOverlayAnimationClasses]} />

		<Dialog.Content
			role="dialog"
			class={[
				`bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl`,
				dialogContentAnimationClasses,
			]}
			style="scrollbar-width: thin"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
			}}
		>
			<div class="sticky top-0 right-0 z-20 ml-auto h-0 w-max">
				<Dialog.Close class="block rounded-full p-4" aria-label="Schließen">
					<div class="btn btn-circle btn-primary shadow-lg drop-shadow-2xl">
						<i class="icon-[ph--x] size-5"></i>
					</div>
				</Dialog.Close>
			</div>

			{#if offering}
				<article>
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
								<h2 class="text-2xl leading-tight font-bold sm:text-3xl">{offering.title}</h2>
								<div class="flex shrink-0 items-center gap-2">
									<!-- Placeholder for close button. -->
									<div class="h-10 w-16" aria-hidden="true"></div>
								</div>
							</div>
							<div class="flex flex-col sm:items-center gap-2 sm:flex-row">
								<span class="badge badge-ghost shrink-0">
									{offering.format === `online` ? `Online` : offering.format === `offline` ? `Vor Ort` : `Vor Ort & Online`}
								</span>
								<div class="sm:grow"></div>

								{#if offering.canManage}
									<div class="flex items-center w-full sm:w-auto justify-center join">
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
										<a href={resolve(routes.editOffering(offering.id) as ResolvablePath)} class="btn btn-sm join-item">
											<i class="icon-[ph--pencil-simple] size-4"></i>
											Bearbeiten
										</a>
									</div>
								{/if}
							</div>

							{#if offering.descriptionHtml?.trim()}
								<div class="prose max-w-none">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- offering descriptions are stored from the trusted EditorJS form. -->
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
			{/if}

			<div class="mt-2 flex w-full justify-center gap-6 pb-6 md:hidden">
				<button type="button" class="btn btn-sm" onclick={handleClose}>
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück zur Übersicht
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.prose a) {
		text-decoration: underline;
	}

	:global(.prose p) {
		margin-bottom: 0.3rem;
		margin-top: 0.3rem;
	}
</style>
