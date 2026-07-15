<script lang="ts">
	import type { RemoteFormFields } from "@sveltejs/kit";
	import type { Snippet } from "svelte";
	import * as v from "valibot";
	import LexicalEditor from "$lib/components/LexicalEditor.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import LocationAutocompleteInput from "$lib/components/LocationAutocompleteInput.svelte";
	import OfferingImageUploadInput from "$lib/components/OfferingImageUploadInput.svelte";
	import {
		OFFERING_FORMATS,
		offeringFormSchema,
		offeringNeedsLocation,
		updateOfferingFormSchema,
		type OfferingFormat,
	} from "$lib/rpc/offerings.common";

	type CreateOfferingForm = typeof import("$lib/rpc/offerings.remote").createOffering;
	type UpdateOfferingForm = typeof import("$lib/rpc/offerings.remote").updateOffering;
	type OfferingRemoteForm = CreateOfferingForm | UpdateOfferingForm;
	type UpdateOnlyFields = Pick<
		RemoteFormFields<v.InferInput<typeof updateOfferingFormSchema>>,
		`existingImageUrls` | `imageOrder` | `offeringId`
	>;

	let {
		remoteForm,
		initialExistingImageUrls = [],
		onImageBusyChange,
		onDirty,
		formId = `offering-form`,
		returnTo = ``,
		format = $bindable<OfferingFormat>(`offline`),
		fieldsHidden = false,
		initialLocationLabel,
		initialLocationLat,
		initialLocationLng,
		locationError = ``,
		oninput,
		onchange,
		onsubmit,
		onSuccess,
		children,
	}: {
		remoteForm: OfferingRemoteForm;
		initialExistingImageUrls?: string[];
		onImageBusyChange?: (busy: boolean) => void;
		onDirty?: () => void;
		formId?: string;
		returnTo?: string;
		format?: OfferingFormat;
		fieldsHidden?: boolean;
		initialLocationLabel?: string | null;
		initialLocationLat?: number | null;
		initialLocationLng?: number | null;
		locationError?: string;
		oninput?: (event: Event) => void;
		onchange?: (event: Event) => void;
		onsubmit?: (event: SubmitEvent) => void;
		onSuccess?: () => void | Promise<void>;
		children?: Snippet;
	} = $props();

	function isUpdateOfferingForm(remoteForm: OfferingRemoteForm): remoteForm is UpdateOfferingForm {
		return `offeringId` in remoteForm.fields;
	}

	function formatLabel(value: OfferingFormat) {
		if (value === `online`) return `Online`;
		if (value === `offline`) return `Vor Ort`;
		if (value === `offline+online`) return `Vor Ort & Online`;
	}

	function formatDescription(value: OfferingFormat) {
		if (value === `online`) return `Video-Call oder anderes Online-Format.`;
		if (value === `offline`) return `Persönlich an dem angegebenen Ort.`;
		return `Du bietest beide Optionen an.`;
	}

	const formProps = $derived.by(() => {
		const form = isUpdateOfferingForm(remoteForm)
			? remoteForm.preflight(updateOfferingFormSchema)
			: remoteForm.preflight(offeringFormSchema);
		if (!onSuccess) return form;

		return form.enhance(async ({ submit }) => {
			if (await submit()) {
				await onSuccess();
			}
		});
	});
	const updateFields = $derived(remoteForm.fields as Partial<UpdateOnlyFields>);
	const resolvedLocationLabel = $derived(
		initialLocationLabel ?? remoteForm.fields.profile.locationLabel.value() ?? null,
	);
	const resolvedLocationLat = $derived(
		initialLocationLat ?? numericFieldValue(remoteForm.fields.profile.latitude.value()),
	);
	const resolvedLocationLng = $derived(
		initialLocationLng ?? numericFieldValue(remoteForm.fields.profile.longitude.value()),
	);

	function numericFieldValue(value: string | null | undefined) {
		if (!value) return null;
		const numberValue = Number(value);
		if (!Number.isFinite(numberValue)) return null;
		return numberValue;
	}
</script>

<form
	{...formProps}
	class="flex flex-col gap-3"
	id={formId}
	oninput={(event) => {
		oninput?.(event);
		onDirty?.();
	}}
	onchange={(event) => {
		onchange?.(event);
		onDirty?.();
	}}
	{onsubmit}
>
	<section class={[`grid gap-4`, fieldsHidden && `hidden`]} data-wizard-step="offering">
		<OfferingImageUploadInput
			field={remoteForm.fields.imageClaims}
			existingImageUrlsField={updateFields.existingImageUrls}
			imageOrderField={updateFields.imageOrder}
			{initialExistingImageUrls}
			onBusyChange={onImageBusyChange}
			{onDirty}
		/>

		<fieldset class="fieldset">
			<input class="input peer w-full" {...remoteForm.fields.title.as(`text`)} required placeholder="z.B. Atemarbeit 1:1 Session" />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Titel *</legend>
			<FormFieldIssues field={remoteForm.fields.title} />
		</fieldset>

		<fieldset class="fieldset">
			<LexicalEditor
				field={remoteForm.fields.descriptionHtml}
				placeholder="Beschreibe dein Angebot"
				{onDirty}
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung</legend>
			<FormFieldIssues field={remoteForm.fields.descriptionHtml} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend font-semibold peer-aria-invalid:text-red-600">Format *</legend>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{#each OFFERING_FORMATS as option (option)}
					<label
						class={[
							`card card-border bg-base-100 relative cursor-pointer border-2 transition-colors`,
							`border-base-500 hover:border-dashed hover:border-primary has-checked:border-solid has-checked:border-primary outline-0`,
						]}
					>
						<input class="peer sr-only" {...remoteForm.fields.format.as(`radio`, option)} bind:group={format} />
						<span
							class={[
								`bg-primary text-primary-content absolute top-3 right-3 flex size-5 items-center justify-center rounded-full`,
								`opacity-0 transition-opacity peer-checked:opacity-100`,
							]}
							aria-hidden="true"
						>
							<i class="icon-[ph--check] size-3"></i>
						</span>
						<div class="card-body gap-1 p-4">
							<span class="text-sm font-semibold">{formatLabel(option)}</span>
							<p class="text-base-content/60 text-sm">{formatDescription(option)}</p>
						</div>
					</label>
				{/each}
			</div>
			<FormFieldIssues field={remoteForm.fields.format} />
		</fieldset>

		{#if offeringNeedsLocation(format)}
			<fieldset class="fieldset">
				<legend class="fieldset-legend peer-aria-invalid:text-red-600">Standort für deine Angebote</legend>
				<div class="min-w-0 flex-1">
					<LocationAutocompleteInput
						inputId="{formId}-location"
						initialLabel={resolvedLocationLabel}
						initialLat={resolvedLocationLat}
						initialLng={resolvedLocationLng}
						locationLabelField={remoteForm.fields.profile.locationLabel}
						latitudeField={remoteForm.fields.profile.latitude}
						longitudeField={remoteForm.fields.profile.longitude}
						onChange={() => onDirty?.()}
					/>
				</div>
				<p class="label whitespace-pre-line">
					Deine Vor-Ort-Angebote werden anderen in der Nähe dieses Orts angezeigt. Der Standort gilt für alle deine Angebote.
				</p>
				{#if locationError}
					<p class="text-error text-sm">{locationError}</p>
				{/if}
				<FormFieldIssues field={remoteForm.fields.profile.locationLabel} />
				<FormFieldIssues field={remoteForm.fields.profile.latitude} />
				<FormFieldIssues field={remoteForm.fields.profile.longitude} />
			</fieldset>
		{/if}
	</section>

	{#if updateFields.offeringId}
		<input class="hidden" readonly {...updateFields.offeringId.as(`number`)} />
	{/if}
	<input type="hidden" {...remoteForm.fields.returnTo.as(`text`)} value={returnTo} />
	
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
