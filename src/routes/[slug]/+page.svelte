<script lang="ts">
	import { routes } from '$lib/routes';
	import EventDetails from '../EventDetails.svelte';

	let { data } = $props();
	const { event, descriptionTeaser } = $derived(data);
</script>

<svelte:head>
	<title>{event.name} | BlissBase</title>
	<meta name="description" content={descriptionTeaser} />

	<meta property="og:title" content={event.name} />
	<meta property="og:description" content={descriptionTeaser} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={`https://blissbase.app/${event.slug}`} />
	{#if event.imageUrls?.[0]}
		<meta property="og:image" content={event.imageUrls[0]} />
	{/if}
</svelte:head>

<div class="container mx-auto max-w-3xl">
	<div class="flex h-14 items-center pl-2">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>

	<div class="bg-base-100 sm:rounded-box overflow-hidden">
		<EventDetails {event} />
	</div>

	<div class="flex w-full justify-center gap-6 py-3">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>
</div>
