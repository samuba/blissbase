<script lang="ts">
	import { page } from "$app/state";
	import OfferingDetails from "../OfferingDetails.svelte";
	import { offeringsListFromReturnTo, routes, withOfferingSlug } from "$lib/routes";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	const offering = $derived(data.offering);
	const offeringsListHref = $derived(
		offeringsListFromReturnTo({
			returnTo: page.url.searchParams.get(`returnTo`),
			origin: page.url.origin,
		}),
	);
	const editReturnTo = $derived(
		offering.slug
			? withOfferingSlug({ path: offeringsListHref, offeringSlug: offering.slug })
			: offeringsListHref,
	);
</script>

<div class="container mx-auto max-w-3xl">
	<div class="bg-base-100 sm:rounded-box overflow-hidden shadow">
		{#key offering.id}
			<OfferingDetails {offering} {editReturnTo} />
		{/key}
	</div>

	<div class="flex w-full justify-center gap-6 py-3">
		<a href={offeringsListHref} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Angebote
		</a>
	</div>
</div>
