<script lang="ts">
	import { goto } from '$app/navigation';
	import EventForm from '$lib/components/EventForm.svelte';
	import { getDefaultCreateEventFieldBase } from '$lib/eventCreateDefaults';
	import { createEvent } from '$lib/rpc/eventMutations.remote';
	import { routes } from '$lib/routes';
	import { UnsavedChangesGuard } from '$lib/unsavedChangesGuard.svelte';

	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	let hasInitializedCreateFields = $state(false);
	const unsaved = new UnsavedChangesGuard();

	$effect(() => {
		if (hasInitializedCreateFields) return;
		createEvent.fields.set(getDefaultCreateEventFieldBase({ timeZone }));
		hasInitializedCreateFields = true;
	});

	function handleCancel() {
		void goto(routes.createHub(), { replaceState: true });
	}

	function handleSaveSuccess() {
		unsaved.clear();
	}
</script>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 md:pb-6">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="text-2xl font-bold">Event erstellen</h1>
				</div>
				<a
					href={routes.createHub()}
					class="btn btn-ghost btn-sm"
					onclick={(e) => {
						e.preventDefault();
						handleCancel();
					}}
				>
					<i class="icon-[ph--arrow-left] size-4"></i>
					Zurück
				</a>
			</div>

			{#if hasInitializedCreateFields}
				<EventForm
					remoteForm={createEvent}
					showAutofillControl
					onDirty={unsaved.markDirty}
					onSuccess={handleSaveSuccess}
				/>
			{/if}

			<div class="flex flex-col-reverse justify-end gap-6 sm:flex-row">
				<button
					type="button"
					onclick={handleCancel}
					class="btn disabled:bg-base-300 disabled:text-base-content"
					disabled={createEvent.pending > 0}
				>
					Abbrechen
				</button>

				<button
					type="submit"
					class="btn btn-primary disabled:bg-primary disabled:text-primary-content"
					form="event-form"
					disabled={createEvent.pending > 0}
				>
					{#if createEvent.pending === 0}
						Speichern
					{:else}
						<span class="loading loading-spinner loading-sm"></span>
						Speichere...
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
