<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { getIsAdminSession } from '$lib/admin.remote';
	import { routes } from '$lib/routes';
	import { deleteEvent } from '$lib/events.remote';

	let { event }: { event: UiEvent } = $props();

	const isAdminSession = $derived(getIsAdminSession());
	let showJson = $state(false);
</script>

{#if isAdminSession.current}
	<div class="border-base-500 mt-6 flex flex-col gap-4 rounded-md border p-4">
		<h3 class="flex items-center text-lg font-semibold">
			<i class="icon-[ph--warning-circle] mr-2 size-6"></i>
			Admin Section
		</h3>
		<div class="">
			<div class="flex flex-wrap justify-between gap-4">
				<div class="flex gap-4">
					<a href={routes.editEvent(event.id)} class="btn btn-primary">
						<i class="icon-[ph--pencil] mr-1 size-4"></i>
						Edit Event
					</a>
					<button class="btn" onclick={() => (showJson = !showJson)}>Show JSON</button>
					<button class="btn btn-warning" onclick={async () => {
						if (confirm('Are you sure you want to delete this event?')) {
							await deleteEvent({
								eventId: event.id,
								hostSecret: 'admin does not need host secret'
							});
						}
					}}>Delete</button>
				</div>
			</div>

			{#if showJson}
				<pre class="text-xs">{JSON.stringify(event, null, 2)}</pre>
			{/if}
		</div>
	</div>
{/if}
