<script lang="ts" module>
	import { pushState, replaceState } from "$app/navigation";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { routes } from "$lib/routes";
	import { untrack } from "svelte";

	let offering = $state<Offering | undefined>(undefined);
	let offeringsById = $state<Record<number, Offering>>({});
	let offeringReturnTo = $state<string | undefined>(undefined);
	let open = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	export function showOfferingDetailsDialog(offeringToShow: Offering, args: { returnTo?: string } = {}) {
		clearCloseTimer();
		offering = offeringToShow;
		offeringReturnTo = args.returnTo;
		offeringsById = {
			...offeringsById,
			[offeringToShow.id]: offeringToShow,
		};
		open = true;

		if (!offeringToShow.slug) return;
		pushState(routes.offeringDetails(offeringToShow.slug), {
			selectedOfferingId: offeringToShow.id,
		});
	}

	function rememberOfferings(offerings: Offering[]) {
		if (!offerings?.length) return;

		const rememberedOfferings = untrack(() => offeringsById);
		let nextOfferingsById: Record<number, Offering> | undefined;

		for (const knownOffering of offerings) {
			if (rememberedOfferings[knownOffering.id] === knownOffering) continue;

			nextOfferingsById ??= { ...rememberedOfferings };
			nextOfferingsById[knownOffering.id] = knownOffering;
		}

		if (!nextOfferingsById) return;
		offeringsById = nextOfferingsById;
	}

	function offeringBySlug(slug: string) {
		return Object.values(offeringsById).find((knownOffering) => knownOffering.slug === slug);
	}

	function clearCloseTimer() {
		if (!closeTimer) return;
		clearTimeout(closeTimer);
		closeTimer = undefined;
	}

	type Offering = {
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
			place?: { name: string; slug: string } | null;
		};
	};

</script>

<script lang="ts">
	import { browser } from "$app/environment";
	import { page } from "$app/state";
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from "$lib/common";
	import { Dialog } from "$lib/components/dialog";
	import OfferingDetails from "./OfferingDetails.svelte";

	let { offerings = [] }: { offerings?: Offering[] } = $props();

	$effect(() => {
		rememberOfferings(offerings);
	});

	$effect(() => {
		const returnOfferingSlug = page.url.searchParams.get(`offering`);
		if (returnOfferingSlug) {
			const returnOffering = offeringBySlug(returnOfferingSlug);
			if (!returnOffering) return;

			clearCloseTimer();
			offering = returnOffering;
			offeringReturnTo = routes.currentPath(page.url);
			open = true;
			return;
		}

		const selectedOfferingId = page.state.selectedOfferingId;
		if (!selectedOfferingId) {
			if (!offering?.slug) return;
			if (page.url.pathname === routes.offeringDetails(offering.slug)) return;
			closeGracefully();
			return;
		}

		const selectedOffering = offeringsById[selectedOfferingId];
		if (!selectedOffering) return;
		clearCloseTimer();
		offering = selectedOffering;
		open = true;
	});

	function handleClose() {
		if (!browser) return;
		if (page.url.searchParams.has(`offering`)) {
			closeReturnToDialog();
			return;
		}

		history.back();
	}

	function closeReturnToDialog() {
		const url = new URL(page.url);
		url.searchParams.delete(`offering`);
		replaceState(routes.currentPath(url), page.state);
		closeGracefully();
	}

	function closeGracefully() {
		open = false;
		clearCloseTimer();
		closeTimer = setTimeout(() => {
			offering = undefined;
			closeTimer = undefined;
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
				<OfferingDetails {offering} editReturnTo={offeringReturnTo} onManaged={handleClose} />
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

