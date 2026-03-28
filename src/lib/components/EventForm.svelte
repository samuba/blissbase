<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicInOut } from 'svelte/easing';
	import * as v from 'valibot';
	import ImageInput from './ImageInput.svelte';
	import {
		createEventSchema,
		updateEventSchema,
		type UpdateEventSchema,
		type ContactMethod
	} from '$lib/events.remote.common';
	import TagsInput from '$lib/components/TagsInput.svelte';
	import EditorJs from '$lib/components/EditorJs.svelte';
	import Select from '$lib/components/Select.svelte';
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import type { RemoteFormFields } from '@sveltejs/kit';

	type CreateEventForm = typeof import('$lib/rpc/eventMutations.remote').createEvent;
	type UpdateEventForm = typeof import('$lib/rpc/eventMutations.remote').updateEvent;
	type EventFormRemoteForm = CreateEventForm | UpdateEventForm;
	type UpdateOnlyFields = Pick<RemoteFormFields<v.InferInput<UpdateEventSchema>>,
		'existingImageUrls' | 'eventId' | 'hostSecret'
	>;

	let {
		remoteForm,
		initialExistingImageUrls = []
	}: {
		remoteForm: EventFormRemoteForm;
		initialExistingImageUrls?: string[];
	} = $props();

	function isUpdateEventForm(remoteForm: EventFormRemoteForm): remoteForm is UpdateEventForm {
		return 'eventId' in remoteForm.fields;
	}

	let preflight = $derived.by(() => {
		if (isUpdateEventForm(remoteForm)) {
			return remoteForm.preflight(updateEventSchema);
		}

		return remoteForm.preflight(createEventSchema);
	});
	let updateFields = $derived(remoteForm.fields as Partial<UpdateOnlyFields>);
	let selectedContactMethod = $derived(
		(remoteForm.fields.contactMethod.value() as ContactMethod | undefined) ?? `none`
	);

	onMount(() => {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		remoteForm.fields.timeZone.set(timeZone);
	});
</script>

<form {...preflight} enctype="multipart/form-data" class="flex flex-col gap-5" id="event-form">
	<ImageInput
		field={remoteForm.fields.images}
		existingImageUrlsField={updateFields.existingImageUrls}
		initialExistingImageUrls={initialExistingImageUrls}
	/>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<fieldset class="fieldset md:col-span-2">
			<input class="input w-full peer user-invalid:validator" {...remoteForm.fields.name.as('text')} required />
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

	<fieldset class="fieldset md:col-span-2">
		<EditorJs field={remoteForm.fields.description} />
		<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung *</legend>
		<FormFieldIssues field={remoteForm.fields.description} />
	</fieldset>

	<div class="flex flex-wrap md:gap-4 gap-6 flex-col md:flex-row md:flex-nowrap">
		<fieldset class="fieldset w-full">
			<label class="label cursor-pointer justify-start gap-2">
				<input class="checkbox" {...remoteForm.fields.isOnline.as('checkbox')} />
				<legend class="font-bold text-base-content text-wrap">Online Event
					<p class="text-xs text-base-content/65 font-normal">Event wird über Video-Call angeboten (Zoom etc.)</p>
				</legend>
			</label>
			<FormFieldIssues field={remoteForm.fields.isOnline} />
		</fieldset>

		<fieldset class="fieldset w-full">
			<label class="label cursor-pointer justify-start gap-2">
				<input class="checkbox" {...remoteForm.fields.isNotListed.as('checkbox')} />
				<legend class="font-bold text-base-content">Event <span class="underline">nicht</span> in Suche anzeigen
					<p class="text-xs text-base-content/65 font-normal text-wrap">Privater Event. Nur sichtbar für Leute denen du den Link gibst.</p>
				</legend>
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
			<TagsInput field={remoteForm.fields.tagIds} />
			<FormFieldIssues field={remoteForm.fields.tagIds} />
		</fieldset>
	</div>

	{#if !remoteForm.fields.isOnline.value()}
		<fieldset class="fieldset" transition:slide={{ duration: 350, easing: cubicInOut }}>
			<textarea
				class="textarea min-h-20 w-full peer disabled:opacity-60"
				{...remoteForm.fields.address.as('text')}
				placeholder="Eine oder mehrere Zeilen, z.B. Studio Name, Straße, Stadt"
			></textarea>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Adresse *</legend>
			<FormFieldIssues field={remoteForm.fields.address} />
		</fieldset>
	{/if}

	<fieldset class="fieldset">
		<legend class="fieldset-legend peer-aria-invalid:text-red-600">Anmeldung / Tickets über </legend>
		<div class="join">
			<Select
				bind:value={() => remoteForm.fields.contactMethod.value(), (v) => remoteForm.fields.contactMethod.set(v)}
				placeholder="Anmelde Methode auswählen"
				onValueChange={() => remoteForm.fields.contact.set('')}
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
		<p class="label wrap-break-words whitespace-pre-line">
			Gib eine Kontakt-Methode ein, z.B. Email, Telefon, Website, WhatsApp, Telegram, etc.
		</p>
		<FormFieldIssues field={remoteForm.fields.contact} />
	</fieldset>

	<div class="hidden">
		<input readonly {...remoteForm.fields.timeZone.as('text')} />
		{#if updateFields.eventId}
			<input readonly {...updateFields.eventId.as('number')} />
		{/if}
		{#if updateFields.hostSecret}
			<input readonly {...updateFields.hostSecret.as('text')} />
		{/if}
	</div>

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
