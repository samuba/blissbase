<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatAddress } from '$lib/common';
	import { updateEvent } from '$lib/events.remote';
	import { allTags, type TagTranslation } from '$lib/tags';
	import { isHttpError } from '@sveltejs/kit';
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { routes } from '$lib/routes';
	import TagsInput from '$lib/components/TagsInput.svelte';

	let { data }: PageProps = $props();
	let { event } = data;

	// Form state
	let formData = $state({
		name: event.name,
		startAt: formatDateForLocalInput(event.startAt), // Format for datetime-local input
		endAt: event.endAt ? formatDateForLocalInput(event.endAt) : '',
		address: (event.address || []).join(', '),
		price: event.price || '',
		priceIsHtml: event.priceIsHtml,
		description: event.description || '',
		summary: event.summary || '',
		imageUrls: (event.imageUrls || []).join('\n'),
		host: event.host || '',
		hostLink: event.hostLink || '',
		sourceUrl: event.sourceUrl || '',
		contact: event.contact || '',
		latitude: event.latitude?.toString() || '',
		longitude: event.longitude?.toString() || '',
		tags: event.tags || [],
		soldOut: event.soldOut,
		listed: event.listed
	});

	// Helper function to format date for datetime-local input in local timezone
	function formatDateForLocalInput(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');

		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	let isSubmitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	// Handle tag selection
	function toggleTag(tag: TagTranslation) {
		if (formData.tags.includes(tag.en)) {
			formData.tags = formData.tags.filter((t) => t !== tag.en);
		} else {
			formData.tags = [...formData.tags, tag.en];
		}
	}

	// Handle form submission
	async function handleSubmit() {
		isSubmitting = true;
		errorMessage = '';
		successMessage = '';

		try {
			const startDate = new Date(formData.startAt);
			let endDate: Date | undefined = undefined;
			if (formData.endAt) {
				endDate = new Date(formData.endAt);
			}

			await updateEvent({
				event: {
					id: event.id,
					name: formData.name,
					startAt: startDate,
					endAt: endDate,
					price: formData.price,
					listed: formData.listed,
					soldOut: formData.soldOut,
					address: formData.address,
					description: formData.description,
					host: formData.host,
					hostLink: formData.hostLink,
					sourceUrl: formData.sourceUrl,
					tags: formData.tags
				},
				hostSecret: page.url.searchParams.get('hostSecret') ?? ''
			});

			successMessage = 'Event updated successfully!';

			goto(routes.eventDetails(event.slug));
		} catch (error) {
			console.error('Error updating event:', error);
			if (isHttpError(error)) {
				errorMessage = 'Error updating event: (' + error.status + ') ' + error.body.message;
			} else {
				errorMessage =
					error instanceof Error
						? error.message
						: 'Failed to update event. ' + JSON.stringify(error);
			}
		} finally {
			isSubmitting = false;
		}
	}

	// Handle cancel
	function handleCancel() {
		goto(`/${event.slug}`);
	}
</script>

<div class="container mx-auto max-w-4xl sm:p-4">
	<!-- Breadcrumb Navigation -->
	<div class="breadcrumbs px-4 text-sm sm:mb-4 sm:px-0">
		<ul>
			<li>
				<a href={routes.eventList()}> <img src="/logo.svg" alt="Logo" class="h-8 min-w-6" /> </a>
			</li>
			<li><a href={routes.eventDetails(event.slug)}>{event.name}</a></li>
			<li>Bearbeiten</li>
		</ul>
	</div>

	<div class="sm:rounded-box bg-base-100 shadow">
		<div class="card-body">
			<h1 class="card-title mb-6 text-2xl">Event bearbeiten</h1>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<!-- Basic Information -->
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Event Name *</legend>
						<input
							type="text"
							bind:value={formData.name}
							required
							class="input w-full"
							placeholder="Event Name"
						/>
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">Preis</legend>
						<input
							type="text"
							bind:value={formData.price}
							class="input w-full"
							placeholder="z.B. 50€ oder Kostenlos"
						/>
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">Start Zeit *</legend>
						<input
							type="datetime-local"
							bind:value={formData.startAt}
							required
							class="input w-full"
						/>
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">End Zeit</legend>
						<input type="datetime-local" bind:value={formData.endAt} class="input w-full" />
					</fieldset>
				</div>

				<!-- Address -->
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Adresse *</legend>
					<textarea
						bind:value={formData.address}
						required
						class="textarea w-full"
						rows="2"
						placeholder="Adresse (eine Zeile pro Adresszeile)"
					></textarea>
				</fieldset>

				<!-- Description -->
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Beschreibung</legend>
					<textarea
						bind:value={formData.description}
						class="textarea w-full"
						rows="6"
						placeholder="Beschreibung des Events (HTML wird unterstützt)"
						maxlength="5000"
					></textarea>
					<p class="label">
						HTML-Tags werden unterstützt. Maximal 5000 Zeichen. ({formData.description.length} Zeichen)
					</p>
				</fieldset>

				<!-- Host Information -->
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Veranstalter Name</legend>
						<input
							type="text"
							bind:value={formData.host}
							class="input w-full"
							placeholder="Veranstalter Name"
						/>
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">Veranstalter Link</legend>
						<input
							type="url"
							bind:value={formData.hostLink}
							class="input w-full"
							placeholder="https://..."
						/>
						<p class="label">z.B. Email, Website, Telegram Link, etc.</p>
					</fieldset>
				</div>

				<fieldset class="fieldset">
					<legend class="fieldset-legend">Tags</legend>
					<div class="mb-1 flex flex-wrap gap-2">
						{#each formData.tags as tag}
							<div class="badge badge-ghost break-keep">
								{allTags.find((t) => t.en === tag)?.de ?? tag}
								<i
									class="icon-[ph--x] size-4 cursor-pointer"
									title="Entfernen"
									onclick={() => toggleTag(allTags.find((t) => t.en === tag)!)}
								/>
							</div>
						{/each}
					</div>
					<TagsInput bind:selectedTags={formData.tags} />
				</fieldset>

				<!-- Options -->
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<label class="label text-black">
						<input type="checkbox" bind:checked={formData.soldOut} class="checkbox" />
						Ausgebucht
					</label>

					<label class="label text-black">
						<input type="checkbox" bind:checked={formData.listed} class="checkbox" />
						In Suche anzeigen
					</label>
				</div>

				<!-- Form Actions -->
				<div class="flex justify-end gap-4 pt-6">
					<button type="button" onclick={handleCancel} class="btn" disabled={isSubmitting}>
						Abbrechen
					</button>
					<button type="submit" class="btn btn-primary" disabled={isSubmitting}>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-sm"></span>
							Speichern...
						{:else}
							Speichern
						{/if}
					</button>
				</div>
			</form>

			{#if errorMessage}
				<div class="alert alert-error mb-4">
					<i class="icon-[ph--warning] size-6"></i>
					<span>{errorMessage}</span>
				</div>
			{/if}

			{#if successMessage}
				<div class="alert alert-success mb-4">
					<i class="icon-[ph--check-circle] size-6"></i>
					<span>{successMessage}</span>
				</div>
			{/if}
		</div>
	</div>
</div>
