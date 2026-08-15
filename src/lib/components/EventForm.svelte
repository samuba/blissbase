<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicInOut } from 'svelte/easing';
	import * as v from 'valibot';
	import ImageInput from './ImageInput.svelte';
	import EventAutofill from './EventAutofill.svelte';
	import {
		createEventSchema,
		eventPlaceLabel,
		updateEventSchema,
		type UpdateEventSchema,
		type ContactMethod
	} from '$lib/events.remote.common';
	import { useDuplicateEventDraftToast } from '$lib/eventDuplicateDraftToast.svelte';
	import TagsInput from '$lib/components/TagsInput.svelte';
	import LexicalEditor from '$lib/components/LexicalEditor.svelte';
	import Select from '$lib/components/Select.svelte';
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import LocationAutocompleteInput from '$lib/components/LocationAutocompleteInput.svelte';
	import type { RemoteFormFields } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import type { UiTag } from '$lib/rpc/TagSelection.remote';

	type CreateEventForm = typeof import('$lib/rpc/eventMutations.remote').createEvent;
	type UpdateEventForm = typeof import('$lib/rpc/eventMutations.remote').updateEvent;
	type EventFormRemoteForm = CreateEventForm | UpdateEventForm;
	type UpdateOnlyFields = Pick<RemoteFormFields<v.InferInput<UpdateEventSchema>>,
		'existingImageUrls' | 'eventId' | 'hostSecret'
	>;

	let {
		remoteForm,
		allTags,
		initialExistingImageUrls = [],
		initialLocationLabel = null,
		initialLocationLat = null,
		initialLocationLng = null,
		showAutofillControl = false,
		fieldsHidden = false,
		onDirty,
		onSuccess,
		onsubmit,
		children,
	}: {
		remoteForm: EventFormRemoteForm;
		allTags: UiTag[];
		initialExistingImageUrls?: string[];
		initialLocationLabel?: string | null;
		initialLocationLat?: string | number | null;
		initialLocationLng?: string | number | null;
		showAutofillControl?: boolean;
		fieldsHidden?: boolean;
		onDirty?: () => void;
		onSuccess?: () => void | Promise<void>;
		onsubmit?: (event: SubmitEvent) => void;
		children?: Snippet;
	} = $props();

	function isUpdateEventForm(remoteForm: EventFormRemoteForm): remoteForm is UpdateEventForm {
		return 'eventId' in remoteForm.fields;
	}

	function isCreateEventForm(remoteForm: EventFormRemoteForm): remoteForm is CreateEventForm {
		return !isUpdateEventForm(remoteForm);
	}

	let formProps = $derived.by(() => {
		const form = isUpdateEventForm(remoteForm)
			? remoteForm.preflight(updateEventSchema)
			: remoteForm.preflight(createEventSchema);
		if (!onSuccess) return form;

		return form.enhance(async ({ submit }) => {
			if (await submit()) {
				await onSuccess();
			}
		});
	});
	let updateFields = $derived(remoteForm.fields as Partial<UpdateOnlyFields>);
	let selectedContactMethod = $derived(
		(remoteForm.fields.contactMethod.value() as ContactMethod | undefined) ?? `none`
	);

	function numericFieldValue(value: string | number | null | undefined) {
		if (value == null || value === ``) return null;
		const numberValue = Number(value);
		if (!Number.isFinite(numberValue)) return null;
		return numberValue;
	}

	let prefillLocation = $state.raw<{
		label: string | null;
		lat: number | null;
		lng: number | null;
	} | null>(null);
	const resolvedLocation = $derived(prefillLocation ?? {
		label: initialLocationLabel,
		lat: numericFieldValue(initialLocationLat),
		lng: numericFieldValue(initialLocationLng),
	});

	function applyLocationPrefill() {
		prefillLocation = {
			label: remoteForm.fields.address.value() ?? null,
			lat: numericFieldValue(remoteForm.fields.latitude.value()),
			lng: numericFieldValue(remoteForm.fields.longitude.value()),
		};
	}

	onMount(() => {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		remoteForm.fields.timeZone.set(timeZone);
	});

	useDuplicateEventDraftToast(() => remoteForm);
</script>

<form
	{...formProps}
	{...onsubmit ? { onsubmit } : {}}
	enctype="multipart/form-data"
	class="flex flex-col gap-5"
	id="event-form"
	oninput={() => onDirty?.()}
	onchange={() => onDirty?.()}
>
	<section class={[`flex flex-col gap-5`, fieldsHidden && `hidden`]} data-wizard-step="event">
	{#if showAutofillControl && isCreateEventForm(remoteForm)}
		<EventAutofill {remoteForm} onPrefill={applyLocationPrefill} />
	{/if}

	<ImageInput
		field={remoteForm.fields.images}
		existingImageUrlsField={updateFields.existingImageUrls}
		initialExistingImageUrls={initialExistingImageUrls}
	/>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<fieldset class="fieldset md:col-span-2">
			<input class="input w-full peer user-invalid:validator" data-testid="event-name-input" {...remoteForm.fields.name.as('text')} required />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Name *</legend>
			<FormFieldIssues field={remoteForm.fields.name} />
		</fieldset>

		<fieldset class="fieldset">
			<input
				class="input w-full peer"
				{...remoteForm.fields.startAt.as('datetime-local')}
				required
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Startzeit *</legend>
			<FormFieldIssues field={remoteForm.fields.startAt} />
		</fieldset>

		<fieldset class="fieldset">
			<input
				class="input w-full peer"
				{...remoteForm.fields.endAt.as('datetime-local')}
				min={remoteForm.fields.startAt.value()}
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Endzeit</legend>
			<FormFieldIssues field={remoteForm.fields.endAt} />
		</fieldset>
	</div>

	<fieldset class="fieldset md:col-span-2" data-testid="event-description-editor">
		<LexicalEditor
			field={remoteForm.fields.description}
			placeholder="Beschreibe deinen Event"
			{onDirty}
		/>
		<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung *</legend>
		<FormFieldIssues field={remoteForm.fields.description} />
	</fieldset>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<fieldset class="fieldset min-w-0">
			<label class="fieldset-label items-start">
				<input class="checkbox shrink-0" data-testid="event-online-checkbox" {...remoteForm.fields.isOnline.as('checkbox')} />
				<span class="font-bold text-base-content text-wrap">Online Event
					<p class="text-xs text-base-content/65 font-normal">Event wird über Video-Call angeboten (Zoom etc.)</p>
				</span>
			</label>
			<FormFieldIssues field={remoteForm.fields.isOnline} />
		</fieldset>

		<fieldset class="fieldset min-w-0">
			<label class="fieldset-label items-start">
				<input class="checkbox shrink-0" {...remoteForm.fields.isNotListed.as('checkbox')} />
				<span class="font-bold text-base-content text-wrap">Event <span class="underline">nicht</span> in Suche anzeigen
					<p class="text-xs text-base-content/65 font-normal">Privater Event. Nur sichtbar für Leute denen du den Link gibst.</p>
				</span>
			</label>
			<FormFieldIssues field={remoteForm.fields.isNotListed} />
		</fieldset>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<fieldset class="fieldset">
			<input class="input w-full peer" {...remoteForm.fields.price.as('text')} placeholder="z.B. 25 EUR" />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Preis</legend>
			<FormFieldIssues field={remoteForm.fields.price} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Tags</legend>
			<TagsInput {allTags} field={remoteForm.fields.tagIds} />
			<FormFieldIssues field={remoteForm.fields.tagIds} />
		</fieldset>
	</div>

	{#if !remoteForm.fields.isOnline.value()}
		<fieldset class="fieldset" transition:slide={{ duration: 350, easing: cubicInOut }}>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Adresse *</legend>
			<LocationAutocompleteInput
				inputId="event-location"
				placeholder="Adresse oder Ort suchen"
				required
				initialLabel={resolvedLocation.label}
				initialLat={resolvedLocation.lat}
				initialLng={resolvedLocation.lng}
				locationLabelField={remoteForm.fields.address}
				latitudeField={remoteForm.fields.latitude}
				longitudeField={remoteForm.fields.longitude}
				formatPlaceLabel={eventPlaceLabel}
				showCurrentLocation={false}
				onChange={() => onDirty?.()}
			/>
			<input
				class="input peer w-full min-w-0"
				data-testid="event-address-note-input"
				aria-label="Adresshinweis"
				{...remoteForm.fields.addressNote.as(`text`)}
				placeholder="Hinweis (optional) z.B. Eingang 2, Stock 3"
			/>
			<FormFieldIssues field={remoteForm.fields.address} />
			<FormFieldIssues field={remoteForm.fields.latitude} />
			<FormFieldIssues field={remoteForm.fields.longitude} />
			<FormFieldIssues field={remoteForm.fields.addressNote} />
		</fieldset>
	{/if}

	<fieldset class="fieldset">
		<legend class="fieldset-legend peer-aria-invalid:text-red-600">Anmeldung / Tickets über </legend>
		<div class="join">
			<Select
				bind:value={() => remoteForm.fields.contactMethod.value(), (v) => remoteForm.fields.contactMethod.set(v)}
				placeholder="Anmelde Methode auswählen"
				onValueChange={() => {
					remoteForm.fields.contact.set('');
					onDirty?.();
				}}
				remoteFunctionField={remoteForm.fields.contactMethod}
				triggerProps={{ class: `rounded-l-full ${!selectedContactMethod || selectedContactMethod === 'none' ? 'rounded-r-full' : ''} ` }}
				options={[
					{
						value: `none`,
						html: `<i class="icon-[ph--x] size-5 text-base-content/50"></i><span>Keine Anmeldung nötig</span>`
					},
					{
						value: `website`,
						html: `<i class="icon-[ph--link] size-5 text-base-content/50"></i><span>Link</span>`
					},
					{
						value: `whatsapp`,
						html: `<i class="icon-[ph--whatsapp-logo] size-5 text-base-content/50"></i><span>WhatsApp</span>`
					},
					{
						value: `telegram`,
						html: `<i class="icon-[ph--telegram-logo] size-5 text-base-content/50"></i><span>Telegram</span>`
					},
					{
						value: `email`,
						html: `<i class="icon-[ph--envelope] size-5 text-base-content/50"></i><span>Email</span>`
					},
					{
						value: `phone`,
						html: `<i class="icon-[ph--phone] size-5 text-base-content/50"></i><span>Telefon</span>`
					}
				] satisfies { value: ContactMethod; html: string }[]}
			/>
			{#if selectedContactMethod && selectedContactMethod !== 'none'}
				<div>
					<label class="input has-user-invalid:validator join-item">
						{#if selectedContactMethod === `email`}
							<input class="w-full peer" {...remoteForm.fields.contact.as('email')} placeholder="tina@example.com" />
						{:else if selectedContactMethod === `phone`}
							<input class="w-full peer" {...remoteForm.fields.contact.as('tel')} placeholder="+49123456789" />
						{:else if selectedContactMethod === `website`}
							<input class="w-full peer" {...remoteForm.fields.contact.as('url')} placeholder="https://www.example.com" />
						{:else if selectedContactMethod === `whatsapp`}
							<input class="w-full peer" {...remoteForm.fields.contact.as('tel')} placeholder="+49123456789" />
						{:else if selectedContactMethod === `telegram`}
							<input class="w-full peer" {...remoteForm.fields.contact.as('text')} placeholder="@username" />
						{/if}
					</label>
				</div>
			{/if}
		</div>
		<p class="label whitespace-pre-line">
			Gib eine Kontakt-Methode ein, z.B. Email, Telefon, Website, WhatsApp, Telegram, etc.
		</p>
		<FormFieldIssues field={remoteForm.fields.contact} />
	</fieldset>

	</section>

	<div class="hidden">
		<input readonly {...remoteForm.fields.timeZone.as('text')} />
		{#if updateFields.eventId}
			<input readonly {...updateFields.eventId.as('number')} />
		{/if}
		{#if updateFields.hostSecret}
			<input readonly {...updateFields.hostSecret.as('text')} />
		{/if}
	</div>

	{@render children?.()}

	{#if remoteForm.fields.allIssues()?.length}
		<div class="alert alert-error alert-soft">
			<ul class="list-disc pl-5">
				{#each remoteForm.fields.allIssues() as issue, i (`${issue.message}-${i}`)}
					<li>{issue.message}</li>
				{/each}
			</ul>
		</div>
	{/if}
</form>
