<script lang="ts" module>
	import { pushState, replaceState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";

	let offering = $state<Offering | undefined>(undefined);
	let open = $state(false);
	let closeBehavior = $state<CloseBehavior>(`back`);

	export function showOfferingDetailsDialog(
		offeringToShow: Offering,
		args: { currentHistoryEntry?: boolean; initialDeepLink?: boolean } = {},
	) {
		offering = offeringToShow;
		open = true;
		closeBehavior = args.initialDeepLink ? `remove-query` : `back`;

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
	type ResolvablePath = `/${string}` & {};
</script>

<script lang="ts">
	import { browser } from "$app/environment";
	import { page } from "$app/state";
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from "$lib/common";
	import ProfileContactButtons from "$lib/components/ProfileContactButtons.svelte";
	import PublicProfileCard from "$lib/components/PublicProfileCard.svelte";
	import { Dialog } from "$lib/components/dialog";

	const selectedOfferingId = $derived(
		(page.state as App.PageState & { selectedOfferingId?: number }).selectedOfferingId ??
			Number(page.url.searchParams.get(`offering`) ?? 0)
	);

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
					<div class="flex flex-col gap-6 p-4 sm:p-6">

						<div class="flex flex-col gap-2">
							<div class="flex justify-between">
								<h2 class="text-2xl leading-tight font-bold sm:text-3xl">{offering.title}</h2>
								<div class="h-10 w-16" aria-hidden="true" /*placeholder for close btn */></div>
							</div>
							<div>
								<span class="badge badge-ghost shrink-0">
									{offering.format === `online`
										? `Online`
										: offering.format === `offline`
										? `Vor Ort`
										: `Vor Ort & Online`}
								</span>
							</div>

							{#if offering.descriptionHtml?.trim()}
								<div class="prose max-w-none">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- offering descriptions are stored from the trusted EditorJS form. -->
									{@html offering.descriptionHtml}
								</div>
							{/if}
						</div>

						{#if offering.profile.slug && offering.profile.displayName}
							<PublicProfileCard profile={offering.profile}>
								<ProfileContactButtons socialLinks={offering.profile.socialLinks} class="sm:items-start"  />
							</PublicProfileCard>
						{/if}

					</div>
				</article>
			{/if}

			<div class="flex w-full justify-center gap-6 pb-6 mt-2 md:hidden">
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
