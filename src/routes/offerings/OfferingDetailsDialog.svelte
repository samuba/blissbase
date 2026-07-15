<script lang="ts" module>
	import { pushState, replaceState } from '$app/navigation';
	import type { OfferingFormat } from '$lib/rpc/offerings.common';
	import type { PublicProfileSocialLinks } from '$lib/rpc/profile.common';
	import {
		BASE_URL,
		parseOfferingDetailsSlugFromUrl,
		routes,
		takeOfferingSlugQuery,
		withOfferingSlug,
	} from '$lib/routes';
	import { ShallowDialogState } from '$lib/shallowDialog.svelte';

	const dialog = new ShallowDialogState();
	let editReturnTo = $state<string | undefined>(undefined);
	let activeSlug = $state<string | null>(null);

	export function showOfferingDetailsDialog(slug: string) {
		editReturnTo = withOfferingSlug({
			path: dialogHostPath(new URL(window.location.href)),
			offeringSlug: slug,
		});
		pushState(routes.offeringDetails(slug), {});
		activeSlug = slug;
		dialog.show();
	}

	function dialogHostPath(url: URL) {
		if (!parseOfferingDetailsSlugFromUrl(url)) return routes.currentPath(url);
		if (!editReturnTo) return routes.offeringsList();

		const returnUrl = new URL(editReturnTo, BASE_URL);
		takeOfferingSlugQuery(returnUrl);
		return routes.currentPath(returnUrl);
	}

	function clearActiveSlug() {
		activeSlug = null;
	}

	type OfferingDetailsDialogOffering = {
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
</script>

<script lang="ts">
	import { dialogContentAnimationClasses, dialogOverlayAnimationClasses } from '$lib/common';
	import { Dialog } from '$lib/components/dialog';
	import OfferingDetails from './OfferingDetails.svelte';
	import { onNavigationUrlChange } from '$lib/shallowDialog.svelte';
	import { onMount } from 'svelte';

	let { offerings }: { offerings: OfferingDetailsDialogOffering[] } = $props();

	const offering = $derived(offerings.find((item) => item.slug === activeSlug));

	onMount(() => {
		const url = new URL(window.location.href);
		const offeringSlug = takeOfferingSlugQuery(url);
		if (offeringSlug) {
			const hostPath = routes.currentPath(url);
			editReturnTo = withOfferingSlug({ path: hostPath, offeringSlug });
			// Replace `?offeringSlug=` with the host page, then push the dialog URL so
			// history.back() closes to the list instead of returning to /edit.
			replaceState(hostPath, {});
			pushState(routes.offeringDetails(offeringSlug), {});
			activeSlug = offeringSlug;
			dialog.show();
		} else {
			syncFromUrl(url);
		}

		return onNavigationUrlChange(syncFromUrl);
	});

	function syncFromUrl(url: URL) {
		const slug = parseOfferingDetailsSlugFromUrl(url);
		if (slug) {
			activeSlug = slug;
			dialog.show();
			return;
		}

		if (!dialog.open && !activeSlug) return;
		dialog.closeGracefully(clearActiveSlug);
	}

	function handleClose() {
		dialog.closeGracefully(clearActiveSlug);
		if (parseOfferingDetailsSlugFromUrl(new URL(window.location.href))) {
			history.back();
		}
	}

	function onOpenChange(shouldOpen: boolean) {
		if (!shouldOpen) handleClose();
	}
</script>

<Dialog.Root open={dialog.open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class={['fixed inset-0 z-50 bg-stone-800/90 transition-opacity', dialogOverlayAnimationClasses]} />

		<Dialog.Content
			role="dialog"
			class={[
				'bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl',
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
					<OfferingDetails {offering} {editReturnTo} onManaged={handleClose} />
				{/key}
			{/if}

			<div class="mt-2 flex w-full justify-center gap-6 pb-6 md:hidden">
				<button type="button" class="btn btn-sm" onclick={handleClose}>
					<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
					Zurück
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
