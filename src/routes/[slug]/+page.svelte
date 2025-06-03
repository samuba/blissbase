<script lang="ts">
	import { routes } from '$lib/routes';
	import EventDetails from '../EventDetails.svelte';

	let { data } = $props();
	const { event } = $derived(data);
</script>

<svelte:head>
	<title>{event.name} | BlissBase</title>
	<meta name="description" content={event.description?.slice(0, 150) ?? ''} />
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

		<div class="flex w-full justify-center gap-6 pb-6">
			<a href={routes.eventList()} class="btn btn-sm">
				<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
				Alle Events
			</a>
		</div>
	</div>
</div>

<style>
	.container {
		min-height: calc(100vh - 4rem); /* Assuming navbar height of 4rem */
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
</style>
