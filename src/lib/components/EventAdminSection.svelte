<script lang="ts">
	import type { UiEvent } from '$lib/server/events';
	import { deleteEvent, getIsAdminSession } from '$lib/admin.remote';
	import { routes } from '$lib/routes';

	let { event }: { event: UiEvent } = $props();

	const isAdminSession = $derived(getIsAdminSession());
	let isDeletingEvent = $state(false);
	let showJson = $state(false);

	async function handleDeleteEvent() {
		if (
			!confirm(
				`Are you sure you want to delete the event "${event.name}"? This action cannot be undone.`
			)
		) {
			return;
		}

		try {
			isDeletingEvent = true;
			await deleteEvent(event.id);
			alert(`Event deleted successfully`);

			// Redirect to home page after deletion
			window.location.href = '/';
		} catch (error) {
			console.error('Failed to delete event:', error);
			alert('Failed to delete event. Please try again.');
		} finally {
			isDeletingEvent = false;
		}
	}
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
				</div>

				<button onclick={handleDeleteEvent} disabled={isDeletingEvent} class="btn btn-warning">
					{#if isDeletingEvent}
						<span class="loading loading-spinner loading-sm"></span>
						Deleting...
					{:else}
						<i class="icon-[ph--trash] mr-1 size-4"></i>
						Delete Event
					{/if}
				</button>
			</div>

			{#if showJson}
				<pre class="text-xs">{JSON.stringify(event, null, 2)}</pre>
			{/if}
		</div>
	</div>
{/if}
