<script lang="ts">
	import { slugify } from '$lib/common';
	import EditorJs from '$lib/components/EditorJs.svelte';
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import ProfileImageCropInput from '$lib/components/ProfileImageCropInput.svelte';
	import PublicProfileSocialLinksEditor from '$lib/components/PublicProfileSocialLinksEditor.svelte';
	import { publicProfileFormSchema } from '$lib/rpc/profile.common';
	import { getPlaces } from '$lib/rpc/places.remote';
	import {
		checkSlugAvailability,
		getMyPublicProfile,
		upsertPublicProfile
	} from '$lib/rpc/profile.remote';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	const profile = $state(await getMyPublicProfile());
	const places = await getPlaces();

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

	let slugCheck = $state<
		`idle` | `checking` | { available: boolean; normalized: string } | `error`
	>(`idle`);

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
			const result = await checkSlugAvailability({ slug: raw }).run();
			slugCheck = { available: result.available, normalized: result.slug };
		} catch (error) {
			console.error(`Slug check failed`, error);
			slugCheck = `error`;
		}
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
	<div class="mb-3 flex flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="min-w-0 flex-1">
			<div class="flex items-center justify-between gap-2">
				<h1 class="text-xl font-bold">Öffentliches Profil</h1>
				<a href={routes.profile()} class="btn btn-ghost btn-sm">
					<i class="icon-[ph--arrow-left] mr-1 size-4"></i>
					Zurück
				</a>
			</div>
		</div>
	</div>

	<form
		{...preflight}
		class={[
			'card bg-base-100 relative flex flex-col gap-5 rounded-none border-0 p-4 shadow sm:p-6 md:rounded-(--radius-box)'
		]}
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
			class={[`grid gap-5 sm:grid-cols-2 sm:items-start sm:gap-4`, currentSlug && `mt-1 sm:mt-2`]}
		>
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
					<div
						class="bg-base-200 border-base-300 flex h-full items-center justify-center rounded-l-full border-r-2 py-0 pr-1 pl-3 text-sm"
					>
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
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Aktueller Ort</legend>
			<select
				class="select w-full"
				{...upsertPublicProfile.fields.placeId.as(`select`)}
				value={profile.placeId ?? ``}
			>
				<option value="">Kein Ort ausgewählt</option>
				{#each places as place (place.id)}
					<option value={place.id}>{place.name}</option>
				{/each}
			</select>
			<p class="label">Deine Angebote werden für diesen Ort gelistet.</p>
			<FormFieldIssues field={upsertPublicProfile.fields.placeId} />
		</fieldset>

		<fieldset class="fieldset">
			<legend class="fieldset-legend">Links</legend>
			<PublicProfileSocialLinksEditor
				bind:socialLinks={profile.socialLinks}
				field={upsertPublicProfile.fields.socialLinks}
				{markDirty}
			/>
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
