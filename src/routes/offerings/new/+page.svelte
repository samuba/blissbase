<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import EditorJs from "$lib/components/EditorJs.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import ProfileImageCropInput from "$lib/components/ProfileImageCropInput.svelte";
	import PublicProfileSocialLinksEditor from "$lib/components/PublicProfileSocialLinksEditor.svelte";
	import { verifyEmailOtp } from "$lib/rpc/auth.remote";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import { createOffering } from "$lib/rpc/offerings.remote";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { getMyPublicProfile } from "$lib/rpc/profile.remote";
	import { getPlaces } from "$lib/rpc/places.remote";
	import { routes } from "$lib/routes";
	import { getSupabaseBrowserClient } from "$lib/supabase";
	import { localeStore } from "../../../locales/localeStore.svelte";
	import OtpVerificationDialog from "./OtpVerificationDialog.svelte";

	type ResolvablePath = `/${string}` & {};

	const isSignedIn = Boolean(page.data.userId);
	const profile = isSignedIn ? await getMyPublicProfile() : null;
	const places = await getPlaces();
	const missingDisplayName = !profile?.displayName?.trim();
	const missingProfileImageUrl = !profile?.profileImageUrl?.trim();
	const missingBannerImageUrl = !profile?.bannerImageUrl?.trim();
	const missingBio = !profile?.bio?.trim();
	const missingPlaceId = !profile?.placeId;
	const missingSocialLinks = !profile?.socialLinks?.some((link) => link.value?.trim());
	const showProfileSection =
		missingDisplayName ||
		missingProfileImageUrl ||
		missingBannerImageUrl ||
		missingBio ||
		missingPlaceId ||
		missingSocialLinks;

	let format = $state<OfferingFormat>(`offline`);
	let offeringImagesBusy = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let email = $state(``);
	let pendingEmail = $state(``);
	let otpCode = $state(``);
	let otpDialogOpen = $state(false);
	let authBusy = $state(false);
	let authError = $state(``);
	let authVerified = $state(isSignedIn);
	let offeringSubmitAuthToken = $state(``);
	let submitError = $state(``);
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);
	const anyImageUploadInFlight = $derived(offeringImagesBusy || profileImageBusy || bannerImageBusy);
	const selectedPlaceId = $derived(createOffering.fields.profile.placeId.value() ?? profile?.placeId?.toString() ?? ``);
	const showPlaceWarning = $derived(!selectedPlaceId && format !== `online`);

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
			offeringSubmitAuthToken = result.offeringSubmitAuthToken;
			createOffering.fields.authToken.set(offeringSubmitAuthToken);
			await invalidateAll();
			if (!page.data.userId && !offeringSubmitAuthToken) {
				authError = `Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.`;
				return;
			}

			authVerified = true;
			otpDialogOpen = false;
			queueMicrotask(() => (document.getElementById(`offering-form`) as HTMLFormElement | null)?.requestSubmit());
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
		if (anyImageUploadInFlight) {
			event.preventDefault();
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return;
		}
		if (authVerified && (page.data.userId || offeringSubmitAuthToken)) return;
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
				<a href={resolve(routes.offeringsList() as ResolvablePath)} class="btn btn-ghost btn-sm">
					<i class="icon-[ph--arrow-left] size-4"></i>
					Zurück
				</a>
			</div>

			<OfferingForm remoteForm={createOffering} bind:format onImageBusyChange={(busy) => (offeringImagesBusy = busy)} onsubmit={onSubmit}>
				<input type="hidden" {...createOffering.fields.authToken.as(`text`)} value={offeringSubmitAuthToken} />

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
					<div class="alert">
						Wanna edit your profile?
						<a href={resolve(routes.editPublicProfile() as ResolvablePath)} class="btn">
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

			</OfferingForm>

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<a href={resolve(routes.offeringsList() as ResolvablePath)} class="btn btn-ghost">Abbrechen</a>
				<button
					type="submit"
					form="offering-form"
					class="btn btn-primary"
					disabled={createOffering.pending > 0 || authBusy || anyImageUploadInFlight}
				>
					{#if anyImageUploadInFlight}
						<span class="loading loading-spinner loading-sm"></span>
						Bilder werden hochgeladen…
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
