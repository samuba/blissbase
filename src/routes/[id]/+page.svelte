<script lang="ts">
	import { routes } from '$lib/routes';
	import EventDetails from '../EventDetails.svelte';
	import { ArrowLeft } from 'phosphor-svelte';

	let { data } = $props();
	const { event } = $derived(data);
</script>

<div class="container mx-auto max-w-3xl">
	<div class="flex h-14 items-center pl-2">
		<a href={routes.eventList()} class="btn btn-sm">
			<ArrowLeft class="mr-1 size-5" />
			Alle Events
		</a>
	</div>

	<div class="bg-base-100 sm:rounded-box overflow-hidden">
		<EventDetails {event} />

		<div class="flex w-full justify-center gap-6 pb-6">
			<a href={routes.eventList()} class="btn btn-sm">
				<ArrowLeft class="mr-1 size-5" />
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
