<script lang="ts">
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import Select from "$lib/components/Select.svelte";
	import { Dialog } from "$lib/components/dialog";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import {
		PROFILE_SOCIAL_TYPES,
		socialIconClass,
		socialIconColorClass,
		socialLabel,
		usernameUrlPrefix,
		type ProfileSocialType,
	} from "$lib/socialLinks";
	import type { RemoteFormField, RemoteFormIssue } from "@sveltejs/kit";
	import { flip } from "svelte/animate";
	import { fade } from "svelte/transition";

	let {
		socialLinks = $bindable(),
		field,
		markDirty,
		revalidate,
	}: {
		socialLinks: PublicProfileSocialLinks;
		field: PublicProfileSocialLinksField;
		markDirty?: () => void;
		revalidate?: () => void | Promise<void>;
	} = $props();

	let addLinkDialogOpen = $state(false);
	let pendingLinkType = $state<ProfileSocialType | undefined>(undefined);
	let pendingLinkValue = $state(``);
	let addLinkError = $state(``);

	const socialRawValues = $derived(socialLinks.map((link) => link.value ?? ``));
	const socialSlotFilled = $derived(socialRawValues.map((raw) => Boolean(raw.trim())));
	const canAddSocialLink = $derived(socialLinks.length < PROFILE_SOCIAL_TYPES.length);
	const addLinkSelectOptions = $derived(
		PROFILE_SOCIAL_TYPES.map((type) => ({
			value: type,
			html: `<i class="${socialIconClass(type)} ${socialIconColorClass(type)} size-5 shrink-0"></i><span>${socialLabel(type)}</span>`,
		})),
	);

	function socialValuePlaceholder(type: ProfileSocialType) {
		if (type === `whatsapp` || type === `phone`) return `z.B. +49123456789`;
		if (type === `email`) return `z.B. name@example.com`;
		if (type === `website`) return `z.B. https://beispiel.de`;
		return `Benutzername`;
	}

	function syncSocialLinks(next: PublicProfileSocialLinks) {
		socialLinks = next;
		field.set(next);
		markDirty?.();
		void revalidate?.();
	}

	function resetAddLinkDialogForm() {
		pendingLinkType = undefined;
		pendingLinkValue = ``;
		addLinkError = ``;
	}

	function onAddLinkOpenChange(next: boolean) {
		addLinkDialogOpen = next;
		if (next) return;
		resetAddLinkDialogForm();
	}

	function openAddLinkDialog() {
		if (!canAddSocialLink) return;
		pendingLinkType = PROFILE_SOCIAL_TYPES[socialLinks.length] ?? PROFILE_SOCIAL_TYPES[0];
		pendingLinkValue = ``;
		addLinkError = ``;
		addLinkDialogOpen = true;
	}

	function onPendingLinkTypeChange() {
		pendingLinkValue = ``;
		addLinkError = ``;
	}

	function confirmAddLink() {
		const type = pendingLinkType;
		if (!type) {
			addLinkError = `Bitte einen Link-Typ wählen.`;
			return;
		}
		let next = pendingLinkValue.trim();
		if (!next) {
			addLinkError = `Bitte einen Wert eingeben.`;
			return;
		}
		if (type === `phone`) {
			next = next.replace(/[^\d+]/g, ``);
		}
		if (/\s/.test(next)) {
			addLinkError = `Leerzeichen ist nicht erlaubt.`;
			return;
		}
		syncSocialLinks([...socialLinks, { type, value: next }]);
		addLinkDialogOpen = false;
		resetAddLinkDialogForm();
	}

	function removeSocialLink(index: number) {
		syncSocialLinks(socialLinks.filter((_, i) => i !== index));
	}

	function onSocialLinkValueInput(args: { index: number; value: string }) {
		const link = socialLinks[args.index];
		if (!link) return;
		if (link.value === args.value) return;

		syncSocialLinks(
			socialLinks.map((existingLink, i) => {
				if (i !== args.index) return existingLink;
				return { ...existingLink, value: args.value };
			}),
		);
	}

	function getHtmlInputType(type: ProfileSocialType) {
		if (type === `email`) return `email`;
		if (type === `whatsapp`) return `tel`;
		return `text`;
	}

	type PublicProfileSocialLinksField = {
		[index: number]: {
			type: RemoteFormField<ProfileSocialType>;
			value: RemoteFormField<string>;
		};
		set: (value: PublicProfileSocialLinks) => PublicProfileSocialLinks;
		issues?: () => RemoteFormIssue[] | undefined;
		allIssues?: () => RemoteFormIssue[] | undefined;
	};
</script>

<div class="flex flex-col gap-4">
	{#if socialLinks.length > 0}
		<ul class="mt-3 flex flex-col gap-4 md:grid md:grid-cols-2">
			{#each socialLinks as link, i (`${link.type}-${i}`)}
				<li
					class={[`bg-base-200 flex flex-col gap-3 rounded-2xl px-4 py-3`]}
					out:fade={{ duration: 160 }}
					animate:flip={{ duration: 370, delay: 50 }}
				>
					<input type="hidden" {...field[i].type.as(`text`)} value={link.type} />
					<fieldset class="fieldset">
						<legend class="fieldset-legend flex w-full items-center justify-between pt-0 pb-1">
							<div class="flex items-center gap-2">
								<i class={[socialIconClass(link.type), socialIconColorClass(link.type), `size-5 shrink-0`]}></i>
								{socialLabel(link.type)}
							</div>
							<button
								type="button"
								class="btn btn-ghost btn-square btn-sm shrink-0"
								aria-label={`${socialLabel(link.type)} entfernen`}
								onclick={() => removeSocialLink(i)}
							>
								<i class="icon-[ph--trash] size-4"></i>
							</button>
						</legend>

						{#if usernameUrlPrefix(link.type)}
							<label class="input w-full pl-0">
								<div
									class="bg-base-200 border-base-300 flex h-full items-center justify-center rounded-l-full border-r-2 py-0 pr-1 pl-3 text-sm leading-tight"
								>
									{usernameUrlPrefix(link.type)?.replace(`https://`, ``)}
								</div>
								<input
									class="input peer w-full grow pl-0 text-sm"
									spellcheck="false"
									placeholder={socialValuePlaceholder(link.type)}
									{...field[i].value.as(`text`)}
									value={link.value}
									oninput={(event) => onSocialLinkValueInput({ index: i, value: event.currentTarget.value })}
								/>
							</label>
						{:else}
							<input
								id={`public-social-link-${link.type}-value`}
								class="input input-bordered w-full"
								type={getHtmlInputType(link.type)}
								placeholder={socialValuePlaceholder(link.type)}
								{...field[i].value.as(`text`)}
								value={link.value}
								oninput={(event) => onSocialLinkValueInput({ index: i, value: event.currentTarget.value })}
							/>
						{/if}
					</fieldset>
				</li>
			{/each}
		</ul>
	{/if}

	<FormFieldIssues {field} />

	<button
		type="button"
		class="btn mx-auto w-fit sm:mx-0"
		onclick={openAddLinkDialog}
		disabled={!canAddSocialLink || socialSlotFilled.length >= PROFILE_SOCIAL_TYPES.length}
	>
		<i class="icon-[ph--globe] -mr-1 size-5"></i>
		<i class="icon-[ph--instagram-logo] -mr-1 size-5 text-[#E4405F]"></i>
		<i class="icon-[ph--facebook-logo] -mr-1 size-5 text-[#1877F2]"></i>
		<i class="icon-[ph--whatsapp-logo] size-5 text-[#25D366]"></i>
		<span class="text-base-content/70 -ml-1 text-sm">…</span>
		Social-Link hinzufügen
	</button>
</div>

<Dialog.Root open={addLinkDialogOpen} onOpenChange={onAddLinkOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			class={[
				`bg-base-100 fixed top-1/2 left-1/2 z-60 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl`,
			]}
		>
			<Dialog.Title class="mb-1 text-xl font-semibold">Link hinzufügen</Dialog.Title>
			<Dialog.Description class="text-base-content/70 mb-4 text-sm">
				Füge einen Kontakt-Link hinzu, damit dich Menschen erreichen können.
			</Dialog.Description>

			<div class="flex flex-col gap-4" id="add-social-link-form">
				<div class="flex flex-col gap-1.5">
					<Select
						triggerProps={{ class: `w-fit` }}
						contentProps={{ class: `z-60` }}
						bind:value={pendingLinkType}
						options={addLinkSelectOptions}
						placeholder="Typ wählen"
						onValueChange={onPendingLinkTypeChange}
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					{#if usernameUrlPrefix(pendingLinkType)}
						<label class="input w-full pl-0">
							<div
								class="bg-base-200 border-base-300 flex h-full items-center justify-center rounded-l-full border-r-2 py-0 pr-1 pl-3 text-sm leading-snug"
							>
								{usernameUrlPrefix(pendingLinkType)?.replace(`https://`, ``)}
							</div>
							<input
								class="input peer w-full grow pl-0 text-sm"
								bind:value={pendingLinkValue}
								spellcheck="false"
								placeholder={pendingLinkType ? socialValuePlaceholder(pendingLinkType) : `Zuerst Typ wählen`}
							/>
						</label>
					{:else}
						<input
							id="public-add-social-value"
							class="input input-bordered w-full"
							spellcheck="false"
							bind:value={pendingLinkValue}
							placeholder={pendingLinkType ? socialValuePlaceholder(pendingLinkType) : `Zuerst Typ wählen`}
							disabled={!pendingLinkType}
						/>
					{/if}
				</div>

				{#if addLinkError}
					<p class="text-error text-sm">{addLinkError}</p>
				{/if}
			</div>

			<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Dialog.Close class="btn btn-ghost" type="button">Abbrechen</Dialog.Close>
				<button type="button" onclick={confirmAddLink} form="add-social-link-form" class="btn btn-primary"> Hinzufügen </button>
			</div>

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
				type="button"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
