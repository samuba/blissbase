<script lang="ts">
	import { slugify } from "$lib/common";
	import LexicalEditor from "$lib/components/LexicalEditor.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import ProfileImageCropInput from "$lib/components/ProfileImageCropInput.svelte";
	import PublicProfileSocialLinksEditor from "$lib/components/PublicProfileSocialLinksEditor.svelte";
	import { publicProfileFormSchema } from "$lib/rpc/profile.common";
	import { checkSlugAvailability, getMyPublicProfile, upsertPublicProfile } from "$lib/rpc/profile.remote";
	import { UnsavedChangesGuard } from "$lib/unsavedChangesGuard.svelte";
	import { resolve } from "$app/paths";

	const profile = $state(await getMyPublicProfile());

	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	const anyImageUploadInFlight = $derived(profileImageBusy || bannerImageBusy);

	function slugFromDisplayName(name: string) {
		return slugify(name)
			.replace(/^-+|-+$/g, ``)
			.slice(0, 80);
	}

	const hasInitialSlug = Boolean(profile.slug?.trim());
	let slugManuallyEdited = $state(hasInitialSlug);

	let slugCheck = $state<`idle` | `checking` | { available: boolean; normalized: string } | `error`>(`idle`);

	const preflight = $derived(upsertPublicProfile.preflight(publicProfileFormSchema));

	const currentSlug = $derived(upsertPublicProfile.fields.slug.value()?.trim() ?? ``);

	function onDisplayNameInput() {
		if (slugManuallyEdited) return;
		const dn = upsertPublicProfile.fields.displayName.value() ?? ``;
		upsertPublicProfile.fields.slug.set(slugFromDisplayName(dn));
		slugCheck = `idle`;
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
		} catch (error) {
			console.error(`Slug check failed`, error);
			slugCheck = `error`;
		}
	}

	const unsaved = new UnsavedChangesGuard();
</script>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl">
	<form
		{...preflight}
		class={["card bg-base-100 relative flex flex-col gap-5 rounded-none border-0 p-4 shadow sm:p-6 md:rounded-(--radius-box)"]}
		id="public-profile-form"
		oninput={unsaved.markDirty}
		onchange={unsaved.markDirty}
		onsubmit={unsaved.clear}
	>
		<h1 class="text-xl sm:text-2xl font-bold">Öffentliches Profil</h1>

		{#if currentSlug}
			<a href={resolve(`/@/[slug]`, { slug: currentSlug })} class="btn btn-ghost btn-sm absolute top-3 right-4 sm:top-4 sm:right-6">
				<i class="icon-[ph--eye] size-4"></i>
				Profil ansehen
			</a>
		{/if}
		<div class={[`grid gap-5 sm:grid-cols-2 sm:items-start sm:gap-4`, currentSlug && `mt-1 sm:mt-2`]}>
			<fieldset class="fieldset min-w-0">
				<input
					class="input peer w-full"
					{...upsertPublicProfile.fields.displayName.as(`text`)}
					value={profile.displayName}
					oninput={onDisplayNameInput}
					autocomplete="name"
				/>
				<legend class="fieldset-legend peer-aria-invalid:text-red-600">Name *</legend>
				<FormFieldIssues field={upsertPublicProfile.fields.displayName} />
			</fieldset>

			<fieldset class="fieldset min-w-0">
				<label class="input w-full pl-0">
					<div class="bg-base-200 border-base-300 flex h-full items-center justify-center rounded-l-full border-r-2 py-0 pr-1 pl-3 text-sm">
						blissbase.app/@/
					</div>
					<input
						class="input peer w-full grow pl-0 text-sm"
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
					<p class={[`mt-1 text-xs`, slugCheck.available ? `text-success` : `text-warning`]}>
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
					unsaved.markDirty();
				}}
			/>
			<ProfileImageCropInput
				kind="banner"
				field={upsertPublicProfile.fields.bannerImageUrl}
				initialUrl={profile.bannerImageUrl}
				onBusyChange={(b) => {
					bannerImageBusy = b;
					unsaved.markDirty();
				}}
			/>
		</div>

		<fieldset class="fieldset">
			<LexicalEditor
				field={upsertPublicProfile.fields.bio}
				value={profile.bio}
				placeholder="Erzähl etwas über dich…"
				onDirty={unsaved.markDirty}
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung</legend>
			<FormFieldIssues field={upsertPublicProfile.fields.bio} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend">Links</legend>
			<PublicProfileSocialLinksEditor
				bind:socialLinks={profile.socialLinks}
				field={upsertPublicProfile.fields.socialLinks}
				markDirty={unsaved.markDirty}
			/>
		</fieldset>

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<button type="submit" class="btn btn-primary" disabled={upsertPublicProfile.pending > 0 || anyImageUploadInFlight}>
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
