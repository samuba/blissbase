<script lang="ts">
	import type { RemoteFormFields } from "@sveltejs/kit";
	import type { Snippet } from "svelte";
	import * as v from "valibot";
	import EditorJs from "$lib/components/EditorJs.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import OfferingImageUploadInput from "$lib/components/OfferingImageUploadInput.svelte";
	import Select from "$lib/components/Select.svelte";
	import { OFFERING_FORMATS, offeringFormSchema, updateOfferingFormSchema, type OfferingFormat } from "$lib/rpc/offerings.common";

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
		formId = `offering-form`,
		returnTo = ``,
		format = $bindable<OfferingFormat>(`offline`),
		fieldsHidden = false,
		onsubmit,
		children,
	}: {
		remoteForm: OfferingRemoteForm;
		initialExistingImageUrls?: string[];
		onImageBusyChange?: (busy: boolean) => void;
		formId?: string;
		returnTo?: string;
		format?: OfferingFormat;
		fieldsHidden?: boolean;
		onsubmit?: (event: SubmitEvent) => void;
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
		if (value === `offline`) return `Persönlich an deinem Profil-Ort.`;
		return `Du bietest beides an.`;
	}

	const preflight = $derived.by(() => {
		if (isUpdateOfferingForm(remoteForm)) return remoteForm.preflight(updateOfferingFormSchema);
		return remoteForm.preflight(offeringFormSchema);
	});
	const updateFields = $derived(remoteForm.fields as Partial<UpdateOnlyFields>);
	const formatOptions = OFFERING_FORMATS.map((option) => ({
		value: option,
		html: `<span>${formatLabel(option)}</span><span class="text-base-content/60 text-xs font-normal">${formatDescription(option)}</span>`,
	}));
</script>

<form {...preflight} class="flex flex-col gap-6" id={formId} {onsubmit}>
	<section class={[`grid gap-4`, fieldsHidden && `hidden`]} data-wizard-step="offering">
		<OfferingImageUploadInput
			field={remoteForm.fields.imageClaims}
			existingImageUrlsField={updateFields.existingImageUrls}
			imageOrderField={updateFields.imageOrder}
			{initialExistingImageUrls}
			onBusyChange={onImageBusyChange}
		/>

		<fieldset class="fieldset">
			<input class="input peer w-full" {...remoteForm.fields.title.as(`text`)} required placeholder="z.B. Atemarbeit 1:1 Session" />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Titel *</legend>
			<FormFieldIssues field={remoteForm.fields.title} />
		</fieldset>

		<fieldset class="fieldset">
			<EditorJs field={remoteForm.fields.descriptionHtml} />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung</legend>
			<FormFieldIssues field={remoteForm.fields.descriptionHtml} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Format *</legend>
			<Select
				bind:value={() => format, (value) => (format = value as OfferingFormat)}
				options={formatOptions}
				remoteFunctionField={remoteForm.fields.format}
				triggerProps={{ class: `peer w-full justify-between text-left` }}
			/>
			<FormFieldIssues field={remoteForm.fields.format} />
		</fieldset>
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
