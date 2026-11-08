<script lang="ts" module>
	import type { UiEvent } from "#lib/server/events.ts";
	import { page } from "$app/state";
	import { afterClientHydration, ShallowDialog } from "#lib/shallowDialog.svelte.ts";
	import { routes, takeEventSlugQuery } from "#lib/routes.ts";

	let event = $state<UiEvent | undefined>(undefined);
	const dialog = new ShallowDialog(routes.root());

	export function showEventDetailsDialog(eventToShow: UiEvent, args: { replace?: boolean } = {}) {
		snapshotReturnTo();
		event = eventToShow;
		dialog.open({
			href: routes.eventDetails(eventToShow.slug),
			state: { selectedEventId: eventToShow.id },
			replace: args.replace,
		});
	}

	function snapshotReturnTo() {
		const url = new URL(window.location.href);
		takeEventSlugQuery(url);
		if (page.state.selectedEventId != null) return;
		dialog.returnToPath = routes.currentPath(url);
	}

	function closeEventDetailsDialog() {
		dialog.close();
	}
</script>

<script lang="ts">
	import { Dialog } from "#lib/components/dialog/index.ts";
	import EventDetails from "./EventDetails.svelte";
	import { eventsStore } from "#lib/eventsStore.svelte.ts";
	import { getEventBySlug } from "#lib/rpc/events.remote.ts";
	import { untrack } from "svelte";

	const isOpen = $derived(page.state.selectedEventId != null);
	let openingEventSlug: string | undefined;

	$effect(() => {
		const href = page.url.href;
		untrack(() => {
			void openFromEventSlugQuery(new URL(href));
		});
	});

	async function openFromEventSlugQuery(url: URL) {
		const queryHref = url.href;
		const eventSlug = takeEventSlugQuery(url);
		if (!eventSlug) return;
		if (event?.slug === eventSlug && page.state.selectedEventId === event.id) return;
		if (openingEventSlug === eventSlug) return;

		openingEventSlug = eventSlug;
		try {
			await afterClientHydration();
			if (page.url.href !== queryHref) return;
			const eventToShow = await getEventBySlug({ slug: eventSlug });
			if (!eventToShow) return;
			if (page.url.href !== queryHref) return;
			if (page.state.selectedEventId) return;
			showEventDetailsDialog(eventToShow, { replace: true });
		} finally {
			if (openingEventSlug === eventSlug) openingEventSlug = undefined;
		}
	}
</script>

<Dialog.Details open={isOpen} onClose={closeEventDetailsDialog}>
	{#if event}
		<EventDetails
			{event}
			onShowEventForTag={(tag) => {
				eventsStore.handleSearchTermChange(tag);
				closeEventDetailsDialog();
			}}
		/>
	{/if}
</Dialog.Details>
