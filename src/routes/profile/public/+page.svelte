<script lang="ts">
	import { slugify } from '$lib/common';
	import EditorJs from '$lib/components/EditorJs.svelte';
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import ProfileImageCropInput from '$lib/components/ProfileImageCropInput.svelte';
	import Select from '$lib/components/Select.svelte';
	import { Dialog } from '$lib/components/dialog';
	import {
		publicProfileFormSchema,
	} from '$lib/rpc/profile.common';
	import { checkSlugAvailability, getMyPublicProfile, upsertPublicProfile } from '$lib/rpc/profile.remote';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { PROFILE_SOCIAL_TYPES, socialIconClass, socialIconColorClass, socialLabel, usernameUrlPrefix, type ProfileSocialType } from '$lib/socialLinks';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';

	const profile = $state(await getMyPublicProfile());

	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	const anyImageUploadInFlight = $derived(profileImageBusy || bannerImageBusy);

	function slugFromDisplayName(name: string) {
		return slugify(name).replace(/^-+|-+$/g, ``).slice(0, 80);
	}

	let slugManuallyEdited = $state(
		Boolean(
			profile.slug?.trim() &&
				slugFromDisplayName(profile.displayName) !== profile.slug.trim()
		)
	);

	let slugCheck = $state<`idle` | `checking` | { available: boolean; normalized: string } | `error`>(
		`idle`
	);

	const preflight = $derived(upsertPublicProfile.preflight(publicProfileFormSchema));

	const currentSlug = $derived(upsertPublicProfile.fields.slug.value()?.trim() ?? ``);

	function onDisplayNameInput() {
		if (slugManuallyEdited) return;
		const dn = upsertPublicProfile.fields.displayName.value() ?? ``;
		upsertPublicProfile.fields.slug.set(slugFromDisplayName(dn));
	}

	function onSlugInput() {
		slugManuallyEdited = true;
		slugCheck = `idle`;
	}

	async function onSlugBlur() {
		const raw = upsertPublicProfile.fields.slug.value()?.trim() ?? ``;
		if (!raw) {
			slugCheck = `idle`;
			return;
		}

		slugCheck = `checking`;
		try {
			const result = await checkSlugAvailability({ slug: raw });
			slugCheck = { available: result.available, normalized: result.slug };
		} catch {
			slugCheck = `error`;
		}
	}

	/** Placeholder for the value field, by link type. */
	function socialValuePlaceholder(type: ProfileSocialType) {
		if (type === `whatsapp` || type === `phone`) return `z.B. +49123456789`;
		if (type === `email`) return `z.B. name@example.com`;
		if (type === `website`) return `z.B. https://beispiel.de`;
		return `Benutzername`;
	}

	let addLinkDialogOpen = $state(false);
	let pendingLinkType = $state<ProfileSocialType | undefined>(undefined);
	let pendingLinkValue = $state(``);
	let addLinkError = $state(``);

	const socialRawValues = $derived(
		PROFILE_SOCIAL_TYPES.map((_, i) => {
			return upsertPublicProfile.fields.socialLinks[i].value.value() ?? profile.socialLinks[i]?.value ?? ``;
		})
	);

	const socialSlotFilled = $derived(socialRawValues.map((raw) => Boolean(raw.trim())));

	const canAddSocialLink = $derived(socialSlotFilled.some((filled) => !filled));

	const addLinkSelectOptions = $derived(
		PROFILE_SOCIAL_TYPES.map((type, i) => ({
			value: type,
			// disabled: socialSlotFilled[i],
			html: `<i class="${socialIconClass(type)} ${socialIconClass(type)} ${socialIconColorClass(type)} size-5 shrink-0"></i><span>${socialLabel(type)}</span>`
		}))
	);

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
		const idx = socialSlotFilled.findIndex((filled) => !filled);
		if (idx < 0) return;
		pendingLinkType = PROFILE_SOCIAL_TYPES[idx];
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
		if (pendingLinkType === "phone") {
			next = next.replace(/[^\d+]/g, ``)
		}
		if (/\s/.test(next)) {
			addLinkError = `Leerzeichen ist nicht erlaubt.`;
			return;
		}
		profile.socialLinks.push({ type, value: next });
		markDirty();
		addLinkDialogOpen = false;
		resetAddLinkDialogForm();
	}

	function removeSocialLink(index: number) {
		profile.socialLinks = profile.socialLinks.filter((_, i) => i !== index);
		markDirty();
	}

	function getHtmlInputType(type: ProfileSocialType) {
		if (type === `email`) return `email`;
		// if (type === `website`) return `url`;
		if (type === `whatsapp`) return `tel`;
		return `text`;
	}

	let isDirty = $state(false);
	// EditorJS fires DOM input events on its contenteditable while it asynchronously
	// renders the initial value, and ProfileImageCropInput may emit an initial busy change.
	// We arm dirty tracking only after those settle, so opening the page doesn't count as edits.
	let dirtyArmed = $state(false);

	onMount(() => {
		// EditorJS onReady awaits renderFromHTML, sleep(300), save, re-render; ~500-800ms in practice.
		const timeout = setTimeout(() => {
			dirtyArmed = true;
		}, 1000);
		return () => clearTimeout(timeout);
	});

	function markDirty() {
		if (!dirtyArmed) return;
		isDirty = true;
	}

	function onFormSubmit() {
		// The server action redirects on success, so we release the guard here.
		// If submission fails and the user edits again, `markDirty` will re-arm it.
		isDirty = false;
	}

	beforeNavigate((navigation) => {
		if (!isDirty) return;
		if (navigation.willUnload) return; // handled by the beforeunload listener below
		const leave = confirm(
			`Du hast ungespeicherte Änderungen. Möchtest du diese Seite wirklich verlassen?`
		);
		if (!leave) navigation.cancel();
	});

	$effect(() => {
		if (!isDirty) return;
		function handleBeforeUnload(event: BeforeUnloadEvent) {
			event.preventDefault();
		}
		window.addEventListener(`beforeunload`, handleBeforeUnload);
		return () => window.removeEventListener(`beforeunload`, handleBeforeUnload);
	});
</script>

<div class="mx-auto w-full max-w-3xl pt-4 md:pt-0">
	<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2 justify-between">
				<h1 class="text-xl font-bold">Öffentliches Profil</h1>
				<a href={resolve(routes.profile())} class="btn btn-ghost btn-sm">
					<i class="icon-[ph--arrow-left] mr-1 size-4"></i>
					Zurück
				</a>
			</div>
		</div>
	</div>

	<form
		{...preflight}
		class={["card border-0 md:rounded-(--radius-box) rounded-none bg-base-100 flex flex-col gap-5 p-4 shadow sm:p-6 relative"]}
		id="public-profile-form"
		oninput={markDirty}
		onchange={markDirty}
		onsubmit={onFormSubmit}
	>
		{#if currentSlug}
			<a
				href={resolve(`/@/[slug]`, { slug: currentSlug })}
				class="btn btn-ghost btn-sm absolute top-3 right-4 sm:top-4 sm:right-6"
			>
				<i class="icon-[ph--eye] size-4"></i>
				Profil ansehen
			</a>
		{/if}
		<div
			class={[
				`grid gap-5 sm:grid-cols-2 sm:gap-4 sm:items-start`,
				currentSlug && `sm:mt-2 mt-1`
			]}
		>
			<fieldset class="fieldset min-w-0">
				<input
					class="input w-full peer"
					{...upsertPublicProfile.fields.displayName.as(`text`)}
					value={profile.displayName}
					oninput={onDisplayNameInput}
					autocomplete="name"
				/>
				<legend class="fieldset-legend peer-aria-invalid:text-red-600">Name *</legend>
				<FormFieldIssues field={upsertPublicProfile.fields.displayName} />
			</fieldset>

			<fieldset class="fieldset min-w-0">
				<label class="input pl-0 w-full">
					<div class="bg-base-200 py-0 h-full flex items-center justify-center pr-1 pl-3 text-sm rounded-l-full border-r-2 border-base-300">
						blissbase.app/@/
					</div>
					<input
						class="input w-full text-sm peer grow pl-0"
						{...upsertPublicProfile.fields.slug.as(`text`)}
						value={profile.slug}
						oninput={onSlugInput}
						onblur={onSlugBlur}
						spellcheck="false"
					/>
				</label>

				<legend class="fieldset-legend peer-aria-invalid:text-red-600">Profil-URL</legend>
				<FormFieldIssues field={upsertPublicProfile.fields.slug} />
				{#if slugCheck === `checking`}
					<p class="text-base-content/60 mt-1 text-xs">Prüfe Verfügbarkeit …</p>
				{:else if slugCheck === `error`}
					<p class="text-error mt-1 text-xs">Slug konnte nicht geprüft werden.</p>
				{:else if typeof slugCheck === `object` && slugCheck}
					<p
						class={[
							`mt-1 text-xs`,
							slugCheck.available ? `text-success` : `text-warning`
						]}
					>
						{#if slugCheck.available}
							„{slugCheck.normalized}“ ist frei.
						{:else}
							„{slugCheck.normalized}“ ist bereits vergeben.
						{/if}
					</p>
				{/if}
			</fieldset>
		</div>

		<div class="grid gap-6 sm:grid-cols-2">
			<ProfileImageCropInput
				kind="profile"
				field={upsertPublicProfile.fields.profileImageUrl}
				initialUrl={profile.profileImageUrl}
				onBusyChange={(b) => {
					profileImageBusy = b;
					markDirty();
				}}
			/>
			<ProfileImageCropInput
				kind="banner"
				field={upsertPublicProfile.fields.bannerImageUrl}
				initialUrl={profile.bannerImageUrl}
				onBusyChange={(b) => {
					bannerImageBusy = b;
					markDirty();
				}}
			/>
		</div>

		<fieldset class="fieldset">
			<EditorJs field={upsertPublicProfile.fields.bio} value={profile.bio} />
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung</legend>
			<FormFieldIssues field={upsertPublicProfile.fields.bio} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend">Links</legend>

			<div class="flex flex-col gap-4">
				<ul class="mt-3 flex flex-col gap-4 md:grid md:grid-cols-2 ">
					{#each profile.socialLinks as link, i (link.type + link.value)}
						<li class={[ `flex flex-col gap-3 rounded-2xl bg-base-200 px-4 py-3`]} out:fade={{ duration: 160 }} animate:flip={{ duration: 370, delay: 50 }}>
							<input
								type="hidden"
								{...upsertPublicProfile.fields.socialLinks[i].type.as(`text`)}
								value={link.type}
							/>
							<fieldset class="fieldset">
								<legend class="fieldset-legend justify-between items-center pt-0 pb-1 w-full">
									<div class="flex items-center gap-2">
										<i class={[ socialIconClass(link.type), socialIconColorClass(link.type), `size-5 shrink-0` ]}></i>
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
									<label class="input pl-0 w-full">
										<div class="bg-base-200 py-0 h-full flex items-center justify-center pr-1 pl-3 text-sm rounded-l-full border-r-2 leading-tight border-base-300 ">
											{usernameUrlPrefix(link.type)?.replace("https://", "")}
										</div>
										<input
											class="input w-full text-sm peer grow pl-0"
											spellcheck="false"
											placeholder={link.type
												? socialValuePlaceholder(link.type)
												: `Zuerst Typ wählen`}
											{...upsertPublicProfile.fields.socialLinks[i].value.as(`text`)}
											value={link.value}
										/>
									</label>
								{:else}
									<input
										id={`public-social-link-${link.type}-value`}
											class="input input-bordered w-full"
											type={getHtmlInputType(link.type)}
											placeholder={link.type
												? socialValuePlaceholder(link.type)
												: `Zuerst Typ wählen`}
											{...upsertPublicProfile.fields.socialLinks[i].value.as(`text`)}
											value={link.value}
										/>
								{/if}
							</fieldset>


						</li>
					{/each}
				</ul>
	
				<FormFieldIssues field={upsertPublicProfile.fields.socialLinks} />
	
				<button
					type="button"
					class="btn w-fit mx-auto sm:mx-0"
					onclick={openAddLinkDialog}
					disabled={!canAddSocialLink}
				>
					<i class="icon-[ph--link] mr-1 size-4"></i>
					Link hinzufügen
				</button>
			</div>
		</fieldset>

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<button
				type="submit"
				class="btn btn-primary"
				disabled={upsertPublicProfile.pending > 0 || anyImageUploadInFlight}
			>
				{#if anyImageUploadInFlight}
					<span class="loading loading-spinner loading-sm"></span>
					Bild wird hochgeladen…
				{:else if upsertPublicProfile.pending === 0}
					Speichern
				{:else}
					<span class="loading loading-spinner loading-sm"></span>
					Speichern…
				{/if}
			</button>
		</div>
	</form>
</div>

<Dialog.Root open={addLinkDialogOpen} onOpenChange={onAddLinkOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			class={[
				`bg-base-100 fixed top-1/2 left-1/2 z-60 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl`
			]}
		>
			<Dialog.Title class="mb-1 text-xl font-semibold">Link hinzufügen</Dialog.Title>
			<Dialog.Description class="text-base-content/70 mb-4 text-sm">
				Pro Typ ist nur ein Eintrag möglich.
			</Dialog.Description>

			<div class="flex flex-col gap-4" id="add-social-link-form" >
				<div class="flex flex-col gap-1.5">
					<Select
						triggerProps={{ class: "w-fit" }}
						contentProps={{ class: "z-60" }}
						bind:value={pendingLinkType}
						options={addLinkSelectOptions}
						placeholder="Typ wählen"
						onValueChange={onPendingLinkTypeChange}
					/>
				</div>

				<div class="flex flex-col gap-1.5">
				{#if usernameUrlPrefix(pendingLinkType)}
					<label class="input pl-0 w-full">
						<div class="bg-base-200 py-0 h-full flex items-center justify-center pr-1 pl-3 text-sm rounded-l-full border-r-2 leading-snug border-base-300 ">
							{usernameUrlPrefix(pendingLinkType)?.replace("https://", "")}
						</div>
						<input
							class="input w-full text-sm peer grow pl-0"
							bind:value={pendingLinkValue}
							spellcheck="false"
							placeholder={pendingLinkType
								? socialValuePlaceholder(pendingLinkType)
								: `Zuerst Typ wählen`}
						/>
					</label>
				{:else}
					<input
							id="public-add-social-value"
							class="input input-bordered w-full"
							spellcheck="false"
							bind:value={pendingLinkValue}
							placeholder={pendingLinkType
								? socialValuePlaceholder(pendingLinkType)
								: `Zuerst Typ wählen`}
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
				<button type="button" onclick={confirmAddLink} form="add-social-link-form" class="btn btn-primary">
					Hinzufügen
				</button>
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
