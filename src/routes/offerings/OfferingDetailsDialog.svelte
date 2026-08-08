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
	/** Set when a slug was opened from `?offeringSlug=`; blocks reopen after dismiss. */
	let consumedQuerySlug: string | null = null;

	export function showOfferingDetailsDialog(slug: string) {
		editReturnTo = withOfferingSlug({
			path: dialogHostPath(new URL(window.location.href)),
			offeringSlug: slug,
		});
		activeSlug = slug;
		consumedQuerySlug = slug;
		dialog.show();
		pushState(routes.offeringDetails(slug), { selectedOfferingSlug: slug });
	}

	/** Call when navigating to edit so return via `?offeringSlug=` can reopen the dialog. */
	export function allowOfferingSlugQueryReopen() {
		consumedQuerySlug = null;
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
			latitude?: number | null;
			longitude?: number | null;
		};
	};
</script>

<script lang="ts">
	import { page } from '$app/state';
	import {
		dialogContentAnimationClasses,
		dialogContentExitAnimationClasses,
		dialogOverlayAnimationClasses,
		dialogOverlayExitAnimationClasses,
	} from '$lib/common';
	import { Dialog } from '$lib/components/dialog';
	import { getOfferingBySlug } from '$lib/rpc/offerings.remote';
	import OfferingDetails from './OfferingDetails.svelte';
	import { untrack } from 'svelte';

	let { offerings }: { offerings: OfferingDetailsDialogOffering[] } = $props();

	let fetchedOffering = $state<OfferingDetailsDialogOffering | null>(null);
	let fetchingSlug = $state<string | null>(null);
	/** Slug whose fetch returned nothing or threw; drives the error state. */
	let loadErrorSlug = $state<string | null>(null);
	let openingOfferingSlug: string | undefined;

	const offeringFromList = $derived(offerings.find((item) => item.slug === activeSlug));
	const offering = $derived(
		offeringFromList ?? (fetchedOffering?.slug === activeSlug ? fetchedOffering : undefined),
	);
	const isLoadingOffering = $derived(
		dialog.open && activeSlug !== null && !offering && loadErrorSlug !== activeSlug,
	);
	const hasLoadError = $derived(
		dialog.open && activeSlug !== null && !offering && loadErrorSlug === activeSlug,
	);

	$effect(() => {
		// close dialog if user clicked browser back button
		if (page.state.selectedOfferingSlug) return;
		dialog.closeGracefully(clearActiveSlug);
	});

	$effect(() => {
		const href = page.url.href;
		untrack(() => {
			void openFromOfferingSlugQuery(new URL(href));
		});
	});

	async function openFromOfferingSlugQuery(url: URL) {
		const offeringSlug = takeOfferingSlugQuery(url);
		if (!offeringSlug) {
			await syncFromUrl(url);
			return;
		}

		const hostPath = routes.currentPath(url);
		// After dismiss, history.back() can restore a stale `?offeringSlug=` in page.url;
		// strip it without reopening.
		if (consumedQuerySlug === offeringSlug && !dialog.open) {
			replaceState(hostPath, {});
			return;
		}

		if (openingOfferingSlug === offeringSlug) return;
		if (
			activeSlug === offeringSlug &&
			dialog.open &&
			page.state.selectedOfferingSlug === offeringSlug
		) {
			replaceState(hostPath, { selectedOfferingSlug: offeringSlug });
			return;
		}

		openingOfferingSlug = offeringSlug;
		try {
			consumedQuerySlug = offeringSlug;
			editReturnTo = withOfferingSlug({ path: hostPath, offeringSlug });
			await ensureOfferingLoaded(offeringSlug);
			if (
				fetchedOffering?.slug !== offeringSlug &&
				!offerings.some((item) => item.slug === offeringSlug)
			) {
				return;
			}

			// Replace `?offeringSlug=` with the host page, then push the dialog URL so
			// history.back() closes to the list instead of returning to /edit.
			replaceState(hostPath, {});
			pushState(routes.offeringDetails(offeringSlug), { selectedOfferingSlug: offeringSlug });
			activeSlug = offeringSlug;
			dialog.show({ noEnterAnimation: true });
		} finally {
			if (openingOfferingSlug === offeringSlug) openingOfferingSlug = undefined;
		}
	}

	async function syncFromUrl(url: URL) {
		const slug = parseOfferingDetailsSlugFromUrl(url);
		if (!slug) return;

		activeSlug = slug;
		// Card click already called show() before pushState; don't override its enter animation.
		// For URL-driven opens (deep link, history nav) show now so the fetch renders a
		// skeleton instead of a blank box, then an error state if it comes back empty.
		if (!dialog.open) {
			if (!page.state.selectedOfferingSlug) {
				replaceState(routes.currentPath(url), { selectedOfferingSlug: slug });
			}
			dialog.show({ noEnterAnimation: true });
		}
		await ensureOfferingLoaded(slug);
	}

	async function ensureOfferingLoaded(slug: string) {
		if (offerings.some((item) => item.slug === slug)) {
			fetchedOffering = null;
			loadErrorSlug = null;
			return;
		}
		if (fetchedOffering?.slug === slug) {
			loadErrorSlug = null;
			return;
		}
		if (fetchingSlug === slug) return;

		loadErrorSlug = null;
		fetchingSlug = slug;
		try {
			const loaded = await getOfferingBySlug({ slug });
			if (fetchingSlug !== slug) return;
			fetchedOffering = loaded;
			if (!loaded) loadErrorSlug = slug;
		} catch {
			if (fetchingSlug === slug) {
				fetchedOffering = null;
				loadErrorSlug = slug;
			}
		} finally {
			if (fetchingSlug === slug) fetchingSlug = null;
		}
	}

	function retryLoad() {
		if (activeSlug) void ensureOfferingLoaded(activeSlug);
	}

	function handleClose() {
		fetchedOffering = null;
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
		<Dialog.Overlay
			class={[
				'fixed inset-0 z-50 bg-stone-800/90 transition-opacity',
				dialog.noEnterAnimation ? dialogOverlayExitAnimationClasses : dialogOverlayAnimationClasses,
			]}
		/>

		<Dialog.Content
			role="dialog"
			class={[
				'bg-base-100 sm:rounded-box fixed top-[50%] left-[50%] z-50 max-h-dvh w-full translate-x-[-50%] translate-y-[-50%] overflow-y-auto shadow-xl outline-hidden sm:max-h-[calc(100%-2rem)] sm:max-w-3xl',
				dialog.noEnterAnimation ? dialogContentExitAnimationClasses : dialogContentAnimationClasses,
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
			{:else if isLoadingOffering}
				<div class="flex flex-col gap-6 p-4 sm:p-6" aria-busy="true">
					<div class="skeleton h-64 w-full"></div>
					<div class="flex flex-col gap-4">
						<div class="skeleton h-8 w-2/3"></div>
						<div class="skeleton h-4 w-1/3"></div>
						<div class="skeleton h-24 w-full"></div>
					</div>
				</div>
			{:else if hasLoadError}
				<div class="flex flex-col items-center gap-4 px-4 py-16 text-center">
					<div
						class="bg-primary/15 text-primary flex size-16 items-center justify-center rounded-full"
					>
						<i class="icon-[ph--hand-heart] size-8"></i>
					</div>
					<h2 class="text-xl font-semibold">Angebot konnte nicht geladen werden</h2>
					<p class="text-base-content/70 max-w-md">
						Das Angebot ist nicht mehr verfügbar oder das Laden hat nicht geklappt.
					</p>
					<div class="flex flex-wrap justify-center gap-2">
						<button type="button" class="btn btn-primary" onclick={retryLoad}>
							Erneut versuchen
						</button>
						<a href={routes.offeringsList()} class="btn">Alle Angebote</a>
					</div>
				</div>
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
