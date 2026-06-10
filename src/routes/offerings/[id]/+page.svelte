<script lang="ts">
	import OfferingDetails from "../OfferingDetails.svelte";
	import { routes } from "$lib/routes";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	const { offering } = $derived(data);
</script>

<div class="container mx-auto max-w-3xl">
	<div class="bg-base-100 sm:rounded-box overflow-hidden shadow">
		<OfferingDetails {offering} />
	</div>

	<div class="flex w-full justify-center gap-6 py-3">
		<a href={routes.offeringsList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Angebote
		</a>
	</div>
</div>
