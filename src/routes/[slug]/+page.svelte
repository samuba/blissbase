<script lang="ts">
	import { goto } from '$app/navigation';
	import { eventsStore } from '$lib/eventsStore.svelte';
	import { routes } from '$lib/routes';
	import EventDetails from '../EventDetails.svelte';

	let { data } = $props();
	const { event } = $derived(data);
</script>

<div class="container mx-auto max-w-3xl">
	<div class="flex h-14 items-center pl-2">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>

	<div class="bg-base-100 sm:rounded-box overflow-hidden">
		<EventDetails
			{event}
			onShowEventForTag={(tag) => {
				eventsStore.handleTagClick(tag);
				goto(routes.eventList());
			}}
		/>
	</div>

	<div class="flex w-full justify-center gap-6 py-3">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>
</div>
