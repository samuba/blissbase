<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { deleteEvent } from '$lib/rpc/eventDelete.remote';
	import { updateEvent } from '$lib/rpc/eventMutations.remote';
	import EventForm from '$lib/components/EventForm.svelte';
	import { type CreateEventSchema, type UpdateEventSchema, updateEventSchema } from '$lib/events.remote.common';
	import type { RemoteForm } from '@sveltejs/kit';
	import type { PageProps } from './$types';
	import * as v from 'valibot';

	let { data }: PageProps = $props();
	let event = $derived(data.event);
	const editFormValues = getInitialEditFormValues();
	const editRemoteForm =
		updateEvent as unknown as RemoteForm<EventFormInput & Partial<v.InferInput<UpdateEventSchema>>, unknown>;

	let isDeletingEvent = $state(false);
	let isSubmitting = $derived(!!updateEvent.pending);

	updateEvent.fields.set(editFormValues);

	function handleCancel() {
		goto(resolve('/[slug]', { slug: event.slug }));
	}

	function getInitialEditFormValues() {
		return data.editFormValues;
	}

	async function handleDeleteEvent() {
		if (
			!confirm(
				`Willst du den Event "${event.name}" wirklich löschen?\nDie Aktion kann nicht rückgängig gemacht werden.`
			)
		) {
			return;
		}

		try {
			isDeletingEvent = true;
			await deleteEvent({
				eventId: event.id,
				hostSecret: page.url.searchParams.get('hostSecret') ?? ''
			});
			goto(resolve('/'));
		} catch (error) {
			console.error(`Failed to delete event:`, error);
			alert(`Failed to delete event. Please try again.`);
		} finally {
			isDeletingEvent = false;
		}
	}

	type EventFormInput = v.InferInput<CreateEventSchema | UpdateEventSchema>;
</script>

<div class="container mx-auto max-w-4xl sm:p-4">
	<div class="breadcrumbs px-4 text-sm sm:mb-4 sm:px-0">
		<ul>
			<li>
				<a href={resolve('/')}>
					<img src="/logo.svg" alt="Logo" class="h-8 min-w-6" />
				</a>
			</li>
			<li><a href={resolve('/[slug]', { slug: event.slug })}>{event.name}</a></li>
			<li>Bearbeiten</li>
		</ul>
	</div>

	<div class="sm:rounded-box bg-base-100 shadow">
		<div class="card-body gap-6">
			<h1 class="card-title text-2xl">Event bearbeiten</h1>

			<EventForm
				remoteForm={editRemoteForm}
				preflightSchema={updateEventSchema}
				initialExistingImageUrls={editFormValues.existingImageUrls}
			/>

			<div class="flex flex-col-reverse sm:flex-row gap-6">

				<div class="flex flex-row sm:flex-row gap-6 w-full">
					<button
						onclick={handleDeleteEvent}
						disabled={isDeletingEvent || isSubmitting}
						type="button"
						class="btn btn-warning disabled:bg-warning disabled:text-warning-content"
					>
						{#if isDeletingEvent}
							<span class="loading loading-spinner loading-sm"></span>
							<span class="">Lösche...</span>
						{:else}
							<i class="icon-[ph--trash] mr-1 size-4"></i>
							<span class="">Event löschen</span>
						{/if}
					</button>
	
					<div class="grow"></div>
	
					<button 
						type="button" 
						onclick={handleCancel} 
						class="btn disabled:bg-base-300 disabled:text-base-content" 
						disabled={isSubmitting || isDeletingEvent}>
						Abbrechen
					</button>
				</div>

				<button 
					type="submit" 
					class="btn btn-primary disabled:bg-primary disabled:text-primary-content" 
					form="event-form" 
					disabled={isSubmitting || isDeletingEvent}
					>
					{#if !isSubmitting}
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
