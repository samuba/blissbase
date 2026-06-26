<script lang="ts" module>
	import { pushState } from "$app/navigation";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { routes } from "$lib/routes";

	let offering = $state<Offering | undefined>(undefined);
	let offeringReturnTo = $state<string | undefined>(undefined);
	let open = $state(false);

	export function showOfferingDetailsDialog(offeringToShow: Offering, args: { returnTo?: string } = {}) {
		if (!offeringToShow.slug) return;
		offering = offeringToShow;
		offeringReturnTo = args.returnTo;
		open = true;
		pushState(routes.offeringDetails(offeringToShow.slug), {
			selectedOfferingId: offeringToShow.id,
		});
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
	import { getOfferingForDialog } from "$lib/rpc/offerings.remote";
	import { replaceState } from "$app/navigation";
	import OfferingDetails from "./OfferingDetails.svelte";

	let openingOfferingSlug = $state<string | undefined>(undefined);
	let isClosing = $state(false);

	$effect(() => {
		const offeringSlug = page.url.searchParams.get(`offering`);

		if (!page.state.selectedOfferingId && offering && !isClosing) {
			closeGracefully();
			if (offeringSlug) {
				replaceState(offeringReturnTo ?? urlWithoutOfferingDialogParam(page.url), {});
			}
			return;
		}

		if (!offeringSlug || isClosing || offering?.slug === offeringSlug || openingOfferingSlug === offeringSlug) {
			return;
		}

		queueMicrotask(() => void openOfferingFromUrl(offeringSlug));
	});

	async function openOfferingFromUrl(offeringSlug: string) {
		if (isClosing || openingOfferingSlug === offeringSlug) return;
		if (offering?.slug === offeringSlug) return;
		openingOfferingSlug = offeringSlug;
		try {
			const offeringToShow = await getOfferingForDialog({ slug: offeringSlug }).run();
			if (isClosing || page.url.searchParams.get(`offering`) !== offeringSlug) return;

			const returnTo = urlWithoutOfferingDialogParam(page.url);
			replaceState(returnTo, {});
			if (!offeringToShow) return;

			showOfferingDetailsDialog(offeringToShow, { returnTo });
		} finally {
			openingOfferingSlug = undefined;
		}
	}

	function handleClose() {
		if (!browser) return;
		closeGracefully();
		replaceState(offeringReturnTo ?? urlWithoutOfferingDialogParam(page.url), {});
	}

	function closeGracefully() {
		if (!offering || isClosing) return;
		isClosing = true;
		open = false;
		setTimeout(() => {
			offering = undefined;
			offeringReturnTo = undefined;
			isClosing = false;
		}, 200); // delayed to not have layout shift during closing animation
	}

	function urlWithoutOfferingDialogParam(url: URL) {
		const nextUrl = new URL(url);
		nextUrl.searchParams.delete(`offering`);
		return routes.currentPath(nextUrl);
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
				{#key offering.id}
					<OfferingDetails {offering} editReturnTo={offeringReturnTo} onManaged={handleClose} />
				{/key}
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

