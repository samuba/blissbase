<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import EditorJs from "$lib/components/EditorJs.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import ProfileImageCropInput from "$lib/components/ProfileImageCropInput.svelte";
	import PublicProfileSocialLinksEditor from "$lib/components/PublicProfileSocialLinksEditor.svelte";
	import Select from "$lib/components/Select.svelte";
	import { verifyEmailOtp } from "$lib/rpc/auth.remote";
	import { OFFERING_FORMATS, offeringFormSchema, type OfferingFormat } from "$lib/rpc/offerings.common";
	import { createOffering } from "$lib/rpc/offerings.remote";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { getMyPublicProfile } from "$lib/rpc/profile.remote";
	import { getPlaces } from "$lib/rpc/places.remote";
	import { routes } from "$lib/routes";
	import { getSupabaseBrowserClient } from "$lib/supabase";
	import { localeStore } from "../../../locales/localeStore.svelte";
	import OtpVerificationDialog from "./OtpVerificationDialog.svelte";

	const profile = await getMyPublicProfile().catch(() => null);
	const places = await getPlaces();
	const isSignedIn = Boolean(page.data.userId);
	const missingDisplayName = !profile?.displayName?.trim();
	const missingSlug = !profile?.slug?.trim();
	const missingProfileImageUrl = !profile?.profileImageUrl?.trim();
	const missingBannerImageUrl = !profile?.bannerImageUrl?.trim();
	const missingBio = !profile?.bio?.trim();
	const missingPlaceId = !profile?.placeId;
	const missingSocialLinks = !profile?.socialLinks?.some((link) => link.value?.trim());
	const showProfileSection =
		missingDisplayName ||
		missingSlug ||
		missingProfileImageUrl ||
		missingBannerImageUrl ||
		missingBio ||
		missingPlaceId ||
		missingSocialLinks;
	const preflight = $derived(createOffering.preflight(offeringFormSchema));

	let formEl = $state<HTMLFormElement | undefined>();
	let format = $state<OfferingFormat>(`offline`);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let email = $state(``);
	let pendingEmail = $state(``);
	let otpCode = $state(``);
	let otpDialogOpen = $state(false);
	let authBusy = $state(false);
	let authError = $state(``);
	let authVerified = $state(isSignedIn);
	let submitError = $state(``);
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);
	const anyImageUploadInFlight = $derived(profileImageBusy || bannerImageBusy);
	const selectedPlaceId = $derived(createOffering.fields.profile.placeId.value() ?? profile?.placeId?.toString() ?? ``);
	const showPlaceWarning = $derived(!selectedPlaceId && format !== `online`);

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

	const formatOptions = OFFERING_FORMATS.map((option) => ({
		value: option,
		html: `<span>${formatLabel(option)}</span><span class="text-base-content/60 text-xs font-normal">${formatDescription(option)}</span>`,
	}));

	async function sendOtpAndOpenDialog() {
		const trimmed = email.trim();
		if (!trimmed || authBusy) {
			submitError = `Bitte gib deine E-Mail-Adresse ein.`;
			return;
		}

		authBusy = true;
		authError = ``;
		submitError = ``;
		try {
			const supabase = getSupabaseBrowserClient();
			const emailRedirectTo = `${window.location.origin}/auth/callback`;
			const { error } = await supabase.auth.signInWithOtp({
				email: trimmed,
				options: {
					emailRedirectTo,
					data: {
						locale: localeStore.locale,
					},
				},
			});
			if (error) throw error;
			pendingEmail = trimmed;
			otpCode = ``;
			otpDialogOpen = true;
		} catch (err: unknown) {
			authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			submitError = authError;
			console.error(`Auth error:`, err);
		} finally {
			authBusy = false;
		}
	}

	async function verifyCodeAndSubmit() {
		const token = otpCode.replace(/\D/g, ``).slice(0, 6);
		if (token.length !== 6 || authBusy) {
			authError = `Bitte gib den 6-stelligen Code ein.`;
			return;
		}

		authBusy = true;
		authError = ``;
		try {
			const result = await verifyEmailOtp({ email: pendingEmail, token });
			if (!result.ok) {
				authError = result.message;
				return;
			}
			authVerified = true;
			otpDialogOpen = false;
			await invalidateAll();
			queueMicrotask(() => formEl?.requestSubmit());
		} catch (err: unknown) {
			authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			authBusy = false;
		}
	}

	function useAnotherEmail() {
		otpDialogOpen = false;
		pendingEmail = ``;
		otpCode = ``;
		authError = ``;
	}

	function onSubmit(event: SubmitEvent) {
		submitError = ``;
		if (authVerified) return;
		event.preventDefault();
		void sendOtpAndOpenDialog();
	}
</script>

<svelte:head>
	<title>Angebot erstellen | Blissbase</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="text-2xl font-bold">Angebot erstellen</h1>
					<p class="text-base-content/70 mt-1 text-sm">
						Ein Angebot ist dauerhaft sichtbar und kann von Menschen direkt über dein Profil angefragt werden.
					</p>
				</div>
				<a href={routes.offeringsList()} class="btn btn-ghost btn-sm">
					<i class="icon-[ph--arrow-left] size-4"></i>
					Zurück
				</a>
			</div>

			<form bind:this={formEl} {...preflight} class="flex flex-col gap-6" id="offering-form" onsubmit={onSubmit}>
				<section class="grid gap-4">
					<fieldset class="fieldset">
						<input
							class="input peer w-full"
							{...createOffering.fields.title.as(`text`)}
							required
							placeholder="z.B. Atemarbeit 1:1 Session"
						/>
						<legend class="fieldset-legend peer-aria-invalid:text-red-600">Titel *</legend>
						<FormFieldIssues field={createOffering.fields.title} />
					</fieldset>

					<fieldset class="fieldset">
						<EditorJs field={createOffering.fields.descriptionHtml} value="" />
						<legend class="fieldset-legend peer-aria-invalid:text-red-600">Beschreibung</legend>
						<FormFieldIssues field={createOffering.fields.descriptionHtml} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend peer-aria-invalid:text-red-600">Format *</legend>
						<Select
							bind:value={() => format, (value) => (format = value as OfferingFormat)}
							options={formatOptions}
							remoteFunctionField={createOffering.fields.format}
							triggerProps={{ class: `peer w-full justify-between text-left` }}
						/>
						<FormFieldIssues field={createOffering.fields.format} />
					</fieldset>
				</section>

				{#if showProfileSection}
					<section class="">
						<div class="grid gap-5 sm:grid-cols-2">
							<fieldset class={[`fieldset`, !missingDisplayName && `hidden`]}>
								<input
									class="input peer w-full"
									{...createOffering.fields.profile.displayName.as(`text`)}
									value={profile?.displayName ?? ``}
									autocomplete="name"
									required
								/>
								<legend class="fieldset-legend peer-aria-invalid:text-red-600">Dein Name *</legend>
								<FormFieldIssues field={createOffering.fields.profile.displayName} />
							</fieldset>

							<fieldset class={[`fieldset`, !missingSlug && `hidden`]}>
								<label class="input w-full pl-0">
									<div
										class="bg-base-200 border-base-300 flex h-full items-center justify-center rounded-l-full border-r-2 py-0 pr-1 pl-3 text-sm"
									>
										blissbase.app/@/
									</div>
									<input
										class="input peer w-full grow pl-0 text-sm"
										{...createOffering.fields.profile.slug.as(`text`)}
										value={profile?.slug ?? ``}
										spellcheck="false"
										placeholder="optional"
									/>
								</label>
								<legend class="fieldset-legend peer-aria-invalid:text-red-600">Profil-URL *</legend>
								<FormFieldIssues field={createOffering.fields.profile.slug} />
							</fieldset>
						</div>

						<div class={[`mt-4 grid gap-6 sm:grid-cols-2`, !missingProfileImageUrl && !missingBannerImageUrl && `hidden`]}>
							<ProfileImageCropInput
								class={!missingProfileImageUrl ? `hidden` : ``}
								kind="profile"
								field={createOffering.fields.profile.profileImageUrl}
								initialUrl={profile?.profileImageUrl ?? ``}
								onBusyChange={(busy) => (profileImageBusy = busy)}
							/>

							<ProfileImageCropInput
								class={!missingBannerImageUrl ? `hidden` : ``}
								kind="banner"
								field={createOffering.fields.profile.bannerImageUrl}
								initialUrl={profile?.bannerImageUrl ?? ``}
								onBusyChange={(busy) => (bannerImageBusy = busy)}
							/>
						</div>

						<fieldset class={[`fieldset`, !missingBio && `hidden`]}>
							<EditorJs field={createOffering.fields.profile.bio} value={profile?.bio ?? ``} />
							<legend class="fieldset-legend peer-aria-invalid:text-red-600"> Profilbeschreibung </legend>
							<FormFieldIssues field={createOffering.fields.profile.bio} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend peer-aria-invalid:text-red-600">Dein aktueller Ort</legend>
							<select
								class="select w-full"
								{...createOffering.fields.profile.placeId.as(`select`)}
								value={profile?.placeId?.toString() ?? ``}
							>
								<option value="">Keine Angabe</option>
								{#each places.map((x) => ({ ...x, id: x.id.toString() })) as place (place.id)}
									<option value={place.id}>{place.name}</option>
								{/each}
							</select>
							<p class="label">Offline-Angebote werden über diesen Ort gefunden.</p>
							<FormFieldIssues field={createOffering.fields.profile.placeId} />
						</fieldset>

						{#if showPlaceWarning}
							<div class="alert alert-warning alert-soft mt-4">
								<i class="icon-[ph--warning-circle] size-5"></i>
								<span>Ohne Ort werden nur deine Online-Angebote auffindbar sein.</span>
							</div>
						{/if}

						<fieldset class={[`fieldset`, !missingSocialLinks && `hidden`]}>
							<legend class="fieldset-legend">Links</legend>
							<PublicProfileSocialLinksEditor bind:socialLinks field={createOffering.fields.profile.socialLinks} />
						</fieldset>
					</section>
				{/if}

				{#if !isSignedIn}
					<fieldset class="fieldset">
						<input
							class="input peer w-full"
							{...createOffering.fields.email.as(`email`)}
							bind:value={email}
							autocomplete="email"
							required
							placeholder="deine@email.de"
						/>
						<legend class="fieldset-legend peer-aria-invalid:text-red-600">E-Mail *</legend>
						<p class="label">Wir senden dir einen Code, bevor dein Angebot gespeichert wird.</p>
						<FormFieldIssues field={createOffering.fields.email} />
					</fieldset>
				{:else}
					<div class="alert ">
						Wanna edit your profile?
						<a href={routes.publicProfile(profile?.slug!)} class="btn">
							<i class="icon-[ph--arrow-right] size-4"></i>
							Edit profile
						</a>
					</div>
				{/if}

				{#if submitError}
					<div class="alert alert-error bg-error/60">
						<i class="icon-[ph--warning] size-6"></i>
						<span>{submitError}</span>
					</div>
				{/if}

				{#if createOffering.fields.allIssues()?.length}
					<div class="alert alert-error alert-soft">
						<ul class="list-disc pl-5">
							{#each createOffering.fields.allIssues() as issue, i (`${issue.message}-${i}`)}
								<li>{issue.message}</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<a href={routes.offeringsList()} class="btn btn-ghost">Abbrechen</a>
					<button type="submit" class="btn btn-primary" disabled={createOffering.pending > 0 || authBusy || anyImageUploadInFlight}>
						{#if anyImageUploadInFlight}
							<span class="loading loading-spinner loading-sm"></span>
							Bild wird hochgeladen…
						{:else if createOffering.pending > 0}
							<span class="loading loading-spinner loading-sm"></span>
							Wird gespeichert…
						{:else if !isSignedIn && !authVerified}
							Code senden
						{:else}
							Angebot speichern
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
</div>

<OtpVerificationDialog
	bind:open={otpDialogOpen}
	{pendingEmail}
	bind:otpCode
	{authBusy}
	{authError}
	onVerify={verifyCodeAndSubmit}
	onUseAnotherEmail={useAnotherEmail}
/>
