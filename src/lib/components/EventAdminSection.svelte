<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { deleteEvent } from '$lib/rpc/eventDelete.remote';
	import { resolve } from '$app/paths';
	import { user } from '$lib/user.svelte';

	let { event }: { event: UiEvent } = $props();

	let showJson = $state(false);
</script>

{#if user.isAdmin}
	<div class="border-base-500 mt-6 flex flex-col gap-4 rounded-md border p-4">
		<h3 class="flex items-center text-lg font-semibold">
			<i class="icon-[ph--shield-star] mr-2 size-6"></i>
			Admin Section
		</h3>
		<div class="">
			<div class="flex flex-wrap justify-between gap-4">
				<div class="join">
					<button class="btn join-item" onclick={async () => {
						if (confirm('Are you sure you want to delete this event?')) {
							const res = await deleteEvent({
								eventId: event.id,
								hostSecret: 'admin does not need host secret'
							});
							if (res.success) {
								history.back();
							}
						}
					}}>Delete</button>
					<button class="btn join-item" onclick={() => (showJson = !showJson)}>Show JSON</button>
					<a href={resolve(`/edit/${event.id ?? 'UNDEFINED'}`)} class="btn join-item">
						<i class="icon-[ph--pencil] mr-1 size-4"></i>
						Edit Event
					</a>
				</div>
			</div>

			{#if showJson}
				<pre class="text-xs">{JSON.stringify(event, null, 2)}</pre>
			{/if}
		</div>
	</div>
{/if}
