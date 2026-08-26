import { onDestroy } from 'svelte';
import DuplicateEventToastLink from '$lib/components/DuplicateEventToastLink.svelte';
import { debounce } from '$lib/common';
import { getExistingEventForDraft } from '$lib/rpc/eventMutations.remote';
import { routes } from '$lib/routes';
import { toast } from 'svelte-sonner';

const DUPLICATE_SLUG_TOAST_ID = `event-draft-duplicate-slug`;

/**
 * For create-event drafts: debounced duplicate check and sonner toast when a matching event exists.
 * @example
 * useDuplicateEventDraftToast(() => remoteForm);
 */
export function useDuplicateEventDraftToast(getRemoteForm: () => CreateEventForm): void {
	let duplicateCheckGeneration = 0;

	onDestroy(() => {
		duplicateCheckGeneration += 1;
		toast.dismiss(DUPLICATE_SLUG_TOAST_ID);
	});

	const checkForDuplicateEvent = debounce(async (args: DuplicateCheckArgs) => {
		try {
			const result = await getExistingEventForDraft({
				name: args.name,
				startAt: args.startAt,
				endAt: args.endAt || undefined,
				timeZone: args.timeZone
			});
			if (args.generation !== duplicateCheckGeneration) return;
			if (result.slug) {
				toast.warning(`Ein Event mit diesem Namen sowie Start- und Endzeit existiert bereits.`, {
					id: DUPLICATE_SLUG_TOAST_ID,
					duration: Number.POSITIVE_INFINITY,
					description: DuplicateEventToastLink,
					componentProps: { href: routes.eventDetails(result.slug) }
				});
			} else {
				toast.dismiss(DUPLICATE_SLUG_TOAST_ID);
			}
		} catch {
			if (args.generation !== duplicateCheckGeneration) return;
			toast.dismiss(DUPLICATE_SLUG_TOAST_ID);
		}
	}, 700);

	$effect(() => {
		const remoteForm = getRemoteForm();
		const name = remoteForm.fields.name.value()?.trim() ?? ``;
		const startAt = remoteForm.fields.startAt.value()?.trim() ?? ``;
		const endAt = remoteForm.fields.endAt.value()?.trim() ?? ``;
		const timeZone = remoteForm.fields.timeZone.value()?.trim() ?? ``;

		if (!name || !startAt || !timeZone) {
			duplicateCheckGeneration += 1;
			toast.dismiss(DUPLICATE_SLUG_TOAST_ID);
			return;
		}

		const runGeneration = ++duplicateCheckGeneration;
		checkForDuplicateEvent({ name, startAt, endAt, timeZone, generation: runGeneration });

		return () => {
			duplicateCheckGeneration += 1;
		};
	});
}

type CreateEventForm = typeof import('$lib/rpc/eventMutations.remote').createEvent;

type DuplicateCheckArgs = {
	name: string;
	startAt: string;
	endAt: string;
	timeZone: string;
	generation: number;
};
