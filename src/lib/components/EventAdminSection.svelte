<script lang="ts">
	import type { UiEvent } from "#lib/server/events.ts";
	import { deleteEvent } from "#lib/rpc/eventDelete.remote.ts";
	import { getEventSourceOrigins } from "#lib/rpc/admin.remote.ts";
	import { routes } from "#lib/routes.ts";
	import { user } from "#lib/user.svelte.ts";
	import type { EventSourceOriginType } from "#lib/server/eventSourceOrigins.ts";

	let {
		event,
	}: {
		event: UiEvent;
	} = $props();

	let showJson = $state(false);

	const sourceOriginsQuery = $derived(user.isAdmin ? getEventSourceOrigins({ eventId: event.id }) : undefined);
	const sourceOrigins = $derived(sourceOriginsQuery?.current ?? []);

	const typeLabels: Record<EventSourceOriginType, string> = {
		scrape: `Website`,
		telegram: `Telegram`,
		whatsapp: `WhatsApp`,
		"website-form": `Formular`,
	};
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
					<button
						class="btn join-item"
						onclick={async () => {
							if (confirm("Are you sure you want to delete this event?")) {
								const res = await deleteEvent({
									eventId: event.id,
									hostSecret: "admin does not need host secret",
								});
								if (res.success) {
									history.back();
								}
							}
						}}>Delete</button
					>

					<button class="btn join-item" onclick={() => (showJson = !showJson)}>Show JSON</button>

					<a href={routes.editEvent(event.id)} class="btn join-item">
						<i class="icon-[ph--pencil] mr-1 size-4"></i>
						Edit Event
					</a>
				</div>
			</div>

			{#if showJson}
				<pre class="text-xs">{JSON.stringify(event, null, 2)}</pre>
			{/if}
		</div>

		{#if sourceOriginsQuery?.loading && !sourceOriginsQuery.current}
			<div class="flex items-center gap-2 text-sm text-base-content/60">
				<span class="loading loading-spinner loading-xs"></span>
				Quellen werden geladen…
			</div>
		{:else if sourceOrigins.length}
			<div>
				<h4 class="mb-2 text-sm font-semibold">Quellen</h4>
				<ul class="flex flex-col gap-2" data-testid="event-source-origins">
					{#each sourceOrigins as origin (origin.type + (origin.chatId ?? origin.label) + (origin.url ?? ``))}
						<li
							class={["flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"]}
							data-testid="event-source-origin"
						>
							<span class={["badge", "badge-ghost", "badge-sm"]}>{typeLabels[origin.type]}</span>
							<span>{origin.label}</span>
							{#if origin.chatId}
								<span class="text-base-content/60">{origin.chatId}</span>
							{/if}
							{#if origin.url}
								<a
									href={origin.url}
									target="_blank"
									rel="noopener noreferrer"
									class="link link-hover break-all"
								>
									{origin.url}
								</a>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
