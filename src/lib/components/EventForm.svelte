<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicInOut } from 'svelte/easing';
	import * as v from 'valibot';
	import ImageInput from './ImageInput.svelte';
	import {
		createEventSchema,
		formatDateForLocalInput,
		updateEventSchema,
		type UpdateEventSchema,
		type ContactMethod
	} from '$lib/events.remote.common';
	import { getDefaultCreateEventFieldBase } from '$lib/eventCreateDefaults';
	import { prefillEventFromDescription } from '$lib/rpc/prefillEventFromDescription.remote';
	import type { CreateEventPrefillFields } from '$lib/server/mapAiAnswerToCreateEventPrefill';
	import { useDuplicateEventDraftToast } from '$lib/eventDuplicateDraftToast.svelte';
	import TagsInput from '$lib/components/TagsInput.svelte';
	import LexicalEditor from '$lib/components/LexicalEditor.svelte';
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
		initialExistingImageUrls = [],
		showAutofillControl = false
	}: {
		remoteForm: EventFormRemoteForm;
		initialExistingImageUrls?: string[];
		showAutofillControl?: boolean;
	} = $props();

	function isUpdateEventForm(remoteForm: EventFormRemoteForm): remoteForm is UpdateEventForm {
		return 'eventId' in remoteForm.fields;
	}

	function isCreateEventForm(remoteForm: EventFormRemoteForm): remoteForm is CreateEventForm {
		return !isUpdateEventForm(remoteForm);
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
	let isAutofillOpen = $state(false);
	let autofillText = $state(``);
	let isPrefilling = $state(false);
	let prefillBanner = $state<{ kind: `source` | `noEvent` | `error`; text: string } | null>(null);

	onMount(() => {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		remoteForm.fields.timeZone.set(timeZone);
	});

	useDuplicateEventDraftToast(() => remoteForm);

	function getDefaultCreateFields(args: { timeZone: string }) {
		return getDefaultCreateEventFieldBase({ timeZone: args.timeZone });
	}

	function getCurrentCreateFields(args: { remoteForm: CreateEventForm; timeZone: string }) {
		const defaults = getDefaultCreateFields({ timeZone: args.timeZone });
		return {
			...defaults,
			name: args.remoteForm.fields.name.value() || defaults.name,
			description: args.remoteForm.fields.description.value() || defaults.description,
			tagIds: (args.remoteForm.fields.tagIds.value() ?? defaults.tagIds).filter(
				(tagId): tagId is string => !!tagId
			),
			price: args.remoteForm.fields.price.value() || defaults.price,
			address: args.remoteForm.fields.address.value() || defaults.address,
			startAt: args.remoteForm.fields.startAt.value() || defaults.startAt,
			endAt: args.remoteForm.fields.endAt.value() || defaults.endAt,
			timeZone: args.remoteForm.fields.timeZone.value() || defaults.timeZone,
			isOnline: args.remoteForm.fields.isOnline.value() ?? defaults.isOnline,
			isNotListed: args.remoteForm.fields.isNotListed.value() ?? defaults.isNotListed,
			contact: args.remoteForm.fields.contact.value() || defaults.contact,
			contactMethod: args.remoteForm.fields.contactMethod.value() || defaults.contactMethod,
			images: (args.remoteForm.fields.images.value() ?? defaults.images).filter((file): file is File => !!file)
		};
	}

	function mergePrefill(
		base: ReturnType<typeof getDefaultCreateFields>,
		prefill: CreateEventPrefillFields
	) {
		return {
			...base,
			name: prefill.name || base.name,
			description: prefill.description || base.description,
			tagIds: prefill.tagIds?.length ? prefill.tagIds : base.tagIds,
			price: prefill.price || base.price,
			address: prefill.address || base.address,
			startAt: prefill.startAtIso
				? formatDateForLocalInput(new Date(prefill.startAtIso))
				: base.startAt,
			endAt: prefill.endAtIso ? formatDateForLocalInput(new Date(prefill.endAtIso)) : base.endAt,
			isOnline: prefill.isOnline,
			isNotListed: prefill.isNotListed,
			contact: prefill.contact || base.contact,
			contactMethod: prefill.contactMethod || base.contactMethod
		};
	}

	async function prefillFromText() {
		const text = autofillText.trim();
		if (!text || isPrefilling) return;
		if (!isCreateEventForm(remoteForm)) return;

		prefillBanner = null;
		isPrefilling = true;
		const timeZone = remoteForm.fields.timeZone.value() || Intl.DateTimeFormat().resolvedOptions().timeZone;
		const currentFields = getCurrentCreateFields({ remoteForm, timeZone });

		try {
			const result = await prefillEventFromDescription({ text, timeZone });
			if (result.kind === `empty`) return;
			if (result.fields.notice === `existingSource` && result.fields.existingSource) {
				prefillBanner = {
					kind: `source`,
					text: `Der Text scheint von einer bestehenden Quelle zu stammen. Wir importieren regelmäßig Events von ${result.fields.existingSource}. Der Event ist also schon bei uns gelistet oder wird es in Kürze sein.`
				};
				return;
			}
			const merged = mergePrefill(currentFields, result.fields);
			remoteForm.fields.set(merged);
			if (result.fields.notice === `noEventData`) {
				prefillBanner = {
					kind: `noEvent`,
					text: `Es wurde kein klarer Event in dem Text erkannt. Du kannst das Formular trotzdem ausfüllen.`
				};
				return;
			}
			autofillText = ``;
			isAutofillOpen = false;
		} catch (e) {
			console.error(e);
			prefillBanner = {
				kind: `error`,
				text: `Fehler beim automatischen Ausfüllen. Du kannst das Formular trotzdem ausfüllen.`
			};
		} finally {
			isPrefilling = false;
		}
	}
</script>

<form {...preflight} enctype="multipart/form-data" class="flex flex-col gap-5" id="event-form">
	{#if showAutofillControl && isCreateEventForm(remoteForm)}
		<fieldset class="fieldset w-full min-w-0 gap-3">
			<div
				class={[
					`flex w-full flex-col rounded-xl border-2 border-dashed border-primary text-primary-content sm:bg-primary/10`,
					prefillBanner?.kind === `error` ? `bg-error/10 text-error` : `bg-primary/5`
				]}
			>
				<button
					type="button"
					onclick={() => (isAutofillOpen = !isAutofillOpen)}
					class="flex h-auto min-h-0 w-full items-center justify-start gap-3 px-4 py-4 text-left normal-case"
					aria-expanded={isAutofillOpen}
				>
					<i class="icon-[ph--magic-wand] size-7 shrink-0"></i>
					<span class="flex min-w-0 flex-col items-start">
						<span class="font-semibold text-sm">Automatisch ausfüllen aus Beschreibung</span>
						<span class="text-base-content/70 text-xs font-normal">
							WhatsApp, Telegram oder andere Event-Beschreibung einfügen
						</span>
					</span>
					<i
						class={[
							`icon-[ph--caret-down] ml-auto size-5 shrink-0 transition-transform`,
							isAutofillOpen ? `rotate-180` : ``
						]}
					></i>
				</button>

				{#if isAutofillOpen}
					<div class="flex flex-col gap-3 px-4 pb-4" transition:slide={{ duration: 250, easing: cubicInOut }}>
						<textarea
							class="textarea min-h-28 w-full font-mono text-sm"
							bind:value={autofillText}
							disabled={isPrefilling}
							placeholder="Event Beschreibung einfügen…"
						></textarea>

						<div class="flex flex-row justify-end gap-3">
							<button
								type="button"
								class="btn"
								onclick={() => (isAutofillOpen = false)}
								disabled={isPrefilling}
							>
								Schließen
							</button>
							<button
								type="button"
								onclick={prefillFromText}
								class="btn btn-primary disabled:bg-primary disabled:text-primary-content"
								disabled={isPrefilling || !autofillText.trim()}
							>
								{#if isPrefilling}
									<span class="loading loading-spinner loading-sm"></span>
									Analysiere Text …
								{:else}
									Daten übernehmen
									<i class="icon-[ph--sparkle] size-5"></i>
								{/if}
							</button>
						</div>

						{#if prefillBanner}
							<div
								class={[
									`alert alert-soft`,
									prefillBanner.kind === `error`
										? `alert-error`
										: prefillBanner.kind === `source`
											? `alert-warning`
											: `alert-info`
								]}
								role={prefillBanner.kind === `error` ? `alert` : `status`}
							>
								{#if prefillBanner.kind === `error`}
									<i class="icon-[ph--warning-circle] size-5 shrink-0"></i>
								{:else}
									<i class="icon-[ph--info] size-5 shrink-0"></i>
								{/if}
								<span>{prefillBanner.text}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</fieldset>
	{/if}

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
		<LexicalEditor
			field={remoteForm.fields.description}
			placeholder="Beschreibe deinen Event"
		/>
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
