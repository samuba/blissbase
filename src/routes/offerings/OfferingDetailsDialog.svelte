<script lang="ts" module>
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { OfferingFormat } from '$lib/rpc/offerings.common';
	import type { PublicProfileSocialLinks } from '$lib/rpc/profile.common';
	import { afterClientHydration, ShallowDialog } from '$lib/shallowDialog.svelte';
	import {
		parseOfferingDetailsSlugFromUrl,
		routes,
		takeOfferingSlugQuery,
		withOfferingSlug,
	} from '$lib/routes';

	let editReturnTo = $state<string | undefined>(undefined);
	const dialog = new ShallowDialog(routes.offeringsList());

	export function showOfferingDetailsDialog(slug: string) {
		snapshotReturnTo();
		editReturnTo = withOfferingSlug({
			path: dialog.returnToPath,
			offeringSlug: slug,
		});
		dialog.open({
			href: routes.offeringDetails(slug),
			state: { selectedOfferingSlug: slug },
		});
	}

	function snapshotReturnTo() {
		const url = new URL(window.location.href);
		takeOfferingSlugQuery(url);
		if (parseOfferingDetailsSlugFromUrl(url)) return;
		dialog.returnToPath = routes.currentPath(url);
	}

	function closeOfferingDetailsDialog() {
		dialog.close();
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

	type OfferingWithSlug = OfferingDetailsDialogOffering & { slug: string };
</script>

<script lang="ts">
	import { Dialog } from '$lib/components/dialog';
	import { getOfferingBySlug } from '$lib/rpc/offerings.remote';
	import OfferingDetails from './OfferingDetails.svelte';
	import { untrack } from 'svelte';

	let { offerings }: { offerings: OfferingDetailsDialogOffering[] } = $props();

	let fetchedOffering = $state<OfferingDetailsDialogOffering | null>(null);
	let fetchingSlug = $state<string | null>(null);
	let openingOfferingSlug: string | undefined;

	const activeSlug = $derived(page.state.selectedOfferingSlug ?? null);
	const isOpen = $derived(activeSlug !== null);
	const offeringFromList = $derived(offerings.find((item) => item.slug === activeSlug));
	let lastOffering: OfferingWithSlug | undefined;
	const offering = $derived.by(() => {
		const value = offeringFromList ?? (fetchedOffering?.slug === activeSlug ? fetchedOffering : undefined);
		if (!value?.slug) return lastOffering;
		lastOffering = { ...value, slug: value.slug };
		return lastOffering;
	});

	$effect(() => {
		const href = page.url.href;
		untrack(() => {
			void openFromOfferingSlugQuery(new URL(href));
		});
	});

	async function openFromOfferingSlugQuery(url: URL) {
		const queryHref = url.href;
		const offeringSlug = takeOfferingSlugQuery(url);
		if (!offeringSlug) return;
		if (openingOfferingSlug === offeringSlug) return;

		const hostPath = routes.currentPath(url);
		openingOfferingSlug = offeringSlug;
		try {
			await afterClientHydration();
			if (page.url.href !== queryHref) return;
			replaceState(hostPath, {});
			await ensureOfferingLoaded(offeringSlug);
			if (page.state.selectedOfferingSlug) return;
			if (
				fetchedOffering?.slug !== offeringSlug &&
				!offerings.some((item) => item.slug === offeringSlug)
			) {
				return;
			}

			showOfferingDetailsDialog(offeringSlug);
		} finally {
			if (openingOfferingSlug === offeringSlug) openingOfferingSlug = undefined;
		}
	}

	async function ensureOfferingLoaded(slug: string) {
		if (offerings.some((item) => item.slug === slug)) {
			fetchedOffering = null;
			return;
		}
		if (fetchedOffering?.slug === slug || fetchingSlug === slug) return;

		fetchingSlug = slug;
		try {
			const loaded = await getOfferingBySlug({ slug });
			if (fetchingSlug !== slug) return;
			fetchedOffering = loaded;
		} finally {
			if (fetchingSlug === slug) fetchingSlug = null;
		}
	}
</script>

<Dialog.Details open={isOpen} onClose={closeOfferingDetailsDialog}>
	{#if offering}
		{#key offering.id}
			<OfferingDetails {offering} {editReturnTo} onManaged={closeOfferingDetailsDialog} />
		{/key}
	{/if}
</Dialog.Details>
