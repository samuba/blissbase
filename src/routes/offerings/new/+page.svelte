<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import LexicalEditor from "$lib/components/LexicalEditor.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import ProfileImageCropInput from "$lib/components/ProfileImageCropInput.svelte";
	import PublicProfileSocialLinksEditor from "$lib/components/PublicProfileSocialLinksEditor.svelte";
	import { verifyEmailOtp } from "$lib/rpc/auth.remote";
	import { offeringNeedsLocation, type OfferingFormat } from "$lib/rpc/offerings.common";
	import { createOffering } from "$lib/rpc/offerings.remote";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { checkEmailProfileComplete, getMyPublicProfile } from "$lib/rpc/profile.remote";
	import { hasValidCoordinates } from "$lib/locationFilter";
	import { routes, safeReturnToPath } from "$lib/routes";
	import { getSupabaseBrowserClient } from "$lib/supabase";
	import { UnsavedChangesGuard } from "$lib/unsavedChangesGuard.svelte";
	import { localeStore } from "../../../locales/localeStore.svelte";
	import OtpStep from "./OtpStep.svelte";
	import { loadFiltersFromBrowserCookie } from "$lib/cookie-utils";

	type WizardStep = `offering` | `profile` | `otp`;
	type WizardStepItem = {
		id: WizardStep;
		label: string;
	};
	type FormFieldWithIssues = {
		issues?: () => unknown[] | undefined;
		allIssues?: () => unknown[] | undefined;
	};

	const isSignedIn = Boolean(page.data.userId);
	let profile = $state(isSignedIn ? await getMyPublicProfile() : null);
	const EMAIL_CHECK_DEBOUNCE_MS = 500;
	const missingDisplayName = !profile?.displayName?.trim();
	const missingProfileImageUrl = !profile?.profileImageUrl?.trim();
	const missingBannerImageUrl = !profile?.bannerImageUrl?.trim();
	const missingBio = !profile?.bio?.trim();
	const missingSocialLinks = !profile?.socialLinks?.some((link) => link.value?.trim());
	const signedInProfileIncomplete =
		missingDisplayName || missingProfileImageUrl || missingBannerImageUrl || missingBio || missingSocialLinks;

	let requestedStep = $state<WizardStep>(`offering`);
	let clientReady = $state(false);
	let format = $state<OfferingFormat>(`offline`);
	let offeringImagesBusy = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let email = $state(``);
	let checkedEmail = $state(``);
	let emailProfileComplete = $state<boolean | null>(isSignedIn);
	let emailCheckBusy = $state(false);
	let emailCheckError = $state(``);
	const emailProfileCheckPromises = new SvelteMap<string, Promise<EmailProfileCheckResult>>();
	let emailProfileCheckDebounce: ReturnType<typeof setTimeout> | null = null;
	let pendingEmail = $state(``);
	let otpCode = $state(``);
	let authBusy = $state(false);
	let authError = $state(``);
	let authVerified = $state(isSignedIn);
	let offeringSubmitAuthToken = $state(``);
	let submitError = $state(``);
	let locationError = $state(``);
	let profileSocialLinkError = $state(``);
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);

	const anyImageUploadInFlight = $derived(offeringImagesBusy || profileImageBusy || bannerImageBusy);
	const profileHasSocialLink = $derived(hasSocialLink(socialLinks));
	const hasSelectedLocation = $derived.by(() => {
		const latValue = createOffering.fields.profile.latitude.value();
		const lngValue = createOffering.fields.profile.longitude.value();
		const lat = latValue === `` ? null : Number(latValue);
		const lng = lngValue === `` ? null : Number(lngValue);
		return hasValidCoordinates({ lat, lng });
	});
	const profileFieldIssues = $derived(hasProfileFieldIssues());
	const profileStepApplies = $derived(
		isSignedIn ? signedInProfileIncomplete || profileFieldIssues : emailProfileComplete !== true || profileFieldIssues,
	);
	const currentStep = $derived.by<WizardStep>(() => {
		if (profileFieldIssues && profileStepApplies) return `profile`;
		if (requestedStep === `profile` && !profileStepApplies) return `offering`;
		if (requestedStep === `otp` && isSignedIn) return `offering`;
		return requestedStep;
	});
	const steps = $derived.by<WizardStepItem[]>(() => [
		{ id: `offering`, label: `Angebot` },
		...(profileStepApplies ? [{ id: `profile`, label: `Profil` } satisfies WizardStepItem] : []),
		...(!isSignedIn ? [{ id: `otp`, label: `Bestätigung` } satisfies WizardStepItem] : []),
	]);
	const currentStepIndex = $derived(
		Math.max(
			0,
			steps.findIndex((step) => step.id === currentStep),
		),
	);
	const isFirstStep = $derived(currentStepIndex <= 0);
	const isLastStep = $derived(currentStepIndex === steps.length - 1);
	const fieldsHidden = $derived(currentStep !== `offering`);
	const showAnonymousEmailField = $derived(!isSignedIn && currentStep === `offering`);
	const renderProfileFields = $derived(profileStepApplies);
	const profileFieldsHidden = $derived(currentStep !== `profile`);
	const showOtpStep = $derived(currentStep === `otp` && !isSignedIn);
	const primaryBusy = $derived(createOffering.pending > 0 || authBusy || emailCheckBusy || anyImageUploadInFlight);
	const returnHref = $derived(
		safeReturnToPath({
			returnTo: page.url.searchParams.get(`returnTo`),
			fallback: routes.offeringsList(),
			origin: page.url.origin,
		}),
	);

	const unsaved = new UnsavedChangesGuard();

	let hasMountedWizardStep = false;
	function scrollToTopOnStepChange() {
		if (!hasMountedWizardStep) {
			hasMountedWizardStep = true;
			return;
		}
		window.scrollTo({ top: 0, behavior: `instant` });
	}

	const initialLocation = $derived.by(() => {
		if (profile?.latitude && profile?.longitude) {
			return { lat: profile.latitude, lng: profile.longitude, label: profile.locationLabel };
		}
		const filters = loadFiltersFromBrowserCookie();
		if (filters?.lat && filters?.lng) {
			return { lat: filters.lat, lng: filters.lng, label: filters.plzCity };
		}
	});

	function fieldHasIssues(field: FormFieldWithIssues) {
		return Boolean(field.issues?.()?.length || field.allIssues?.()?.length);
	}

	function hasProfileFieldIssues() {
		const profileFields = createOffering.fields.profile;
		return Boolean(
			fieldHasIssues(profileFields.displayName) ||
			fieldHasIssues(profileFields.profileImageUrl) ||
			fieldHasIssues(profileFields.bannerImageUrl) ||
			fieldHasIssues(profileFields.bio) ||
			fieldHasIssues(profileFields.locationLabel) ||
			fieldHasIssues(profileFields.latitude) ||
			fieldHasIssues(profileFields.longitude) ||
			fieldHasIssues(profileFields.socialLinks),
		);
	}

	function requestOfferingSubmit() {
		queueMicrotask(() => (document.getElementById(`offering-form`) as HTMLFormElement | null)?.requestSubmit());
	}

	function validateCurrentStep() {
		const sections = document.querySelectorAll<HTMLElement>(`[data-wizard-step="${currentStep}"]`);
		if (!sections.length) return true;
		for (const section of sections) {
			const controls = section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`input, select, textarea`);
			for (const control of controls) {
				if (control.disabled || control.type === `hidden`) continue;
				if (control.checkValidity()) continue;
				control.reportValidity();
				return false;
			}
		}
		return true;
	}

	/**
	 * Profile-step checks: at least one social link (not in preflight schema — server merges
	 * existing profile links), then schema preflight for format / other profile fields.
	 */
	async function validateProfileStep() {
		if (!profileHasSocialLink) {
			profileSocialLinkError = `Bitte füge mindestens einen Social-Link hinzu.`;
			return false;
		}
		profileSocialLinkError = ``;

		createOffering.fields.profile.socialLinks.set(socialLinks);
		await createOffering.validate({ includeUntouched: true, preflightOnly: true });
		return !hasProfileFieldIssues();
	}

	function validateOfferingLocation() {
		if (!offeringNeedsLocation(format)) {
			locationError = ``;
			return true;
		}
		if (!hasSelectedLocation) {
			locationError = `Bitte wähle einen Ort aus den Vorschlägen oder nutze deinen aktuellen Standort.`;
			return false;
		}
		locationError = ``;
		return true;
	}

	function hasSocialLink(links: PublicProfileSocialLinks) {
		return links.some((link) => link.value?.trim());
	}

	function getSocialLinks() {
		return socialLinks;
	}

	function setSocialLinks(nextSocialLinks: PublicProfileSocialLinks) {
		socialLinks = nextSocialLinks;
		unsaved.markDirty();
		if (!hasSocialLink(nextSocialLinks)) return;
		profileSocialLinkError = ``;
	}

	function resetEmailProfileCheck(emailValue = email) {
		const trimmed = emailValue.trim();
		clearEmailProfileCheckDebounce();
		if (checkedEmail !== trimmed) {
			emailProfileComplete = null;
			checkedEmail = ``;
		}
		emailCheckError = ``;
		authVerified = false;
		offeringSubmitAuthToken = ``;
		createOffering.fields.authToken.set(``);
		if (!trimmed) return;
		emailProfileCheckDebounce = setTimeout(() => {
			emailProfileCheckDebounce = null;
			void checkEmailProfileStatus({ showError: false });
		}, EMAIL_CHECK_DEBOUNCE_MS);
	}

	function onEmailInput(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		email = input.value;
		resetEmailProfileCheck(input.value);
	}

	function clearEmailProfileCheckDebounce() {
		if (!emailProfileCheckDebounce) return;
		clearTimeout(emailProfileCheckDebounce);
		emailProfileCheckDebounce = null;
	}

	function getEmailProfileCheck(trimmed: string) {
		const existingPromise = emailProfileCheckPromises.get(trimmed);
		if (existingPromise) return existingPromise;

		const promise = checkEmailProfileComplete({ email: trimmed })
			.then(
				(result) =>
					({
						ok: true,
						profileComplete: result.profileComplete,
					}) satisfies EmailProfileCheckResult,
			)
			.catch(
				(err: unknown) =>
					({
						ok: false,
						message: err instanceof Error ? err.message : `E-Mail konnte nicht geprüft werden.`,
					}) satisfies EmailProfileCheckResult,
			)
			.finally(() => {
				if (emailProfileCheckPromises.get(trimmed) !== promise) return;
				emailProfileCheckPromises.delete(trimmed);
			});
		emailProfileCheckPromises.set(trimmed, promise);
		return promise;
	}

	async function checkEmailProfileStatus(args: { showError: boolean }) {
		const trimmed = email.trim();
		if (isSignedIn) return true;
		if (!trimmed) {
			if (args.showError) emailCheckError = `Bitte gib deine E-Mail-Adresse ein.`;
			emailProfileComplete = null;
			return false;
		}
		if (checkedEmail === trimmed && emailProfileComplete !== null) return true;

		if (args.showError) emailCheckError = ``;
		const result = await getEmailProfileCheck(trimmed);
		if (email.trim() !== trimmed) return false;
		if (result.ok) {
			emailCheckError = ``;
			checkedEmail = trimmed;
			emailProfileComplete = result.profileComplete;
			return true;
		}

		emailProfileComplete = null;
		if (args.showError) emailCheckError = result.message;
		return false;
	}

	async function onEmailBlur() {
		clearEmailProfileCheckDebounce();
		await checkEmailProfileStatus({ showError: false });
	}

	async function sendOtpCode(args: { emailAddress?: string; resetCode?: boolean } = {}) {
		const trimmed = (args.emailAddress ?? email).trim();
		if (!trimmed || authBusy) {
			authError = `Bitte gib deine E-Mail-Adresse ein.`;
			return false;
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
			if (args.resetCode !== false) otpCode = ``;
			return true;
		} catch (err: unknown) {
			authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			submitError = authError;
			console.error(`Auth error:`, err);
			return false;
		} finally {
			authBusy = false;
		}
	}

	async function enterOtpStep() {
		const trimmed = email.trim();
		const sent = await sendOtpCode({ emailAddress: trimmed });
		if (!sent) return;
		requestedStep = `otp`;
	}

	async function verifyCodeAndSubmit() {
		const token = otpCode.replace(/\D/g, ``).slice(0, 6);
		if (token.length !== 6 || authBusy) {
			authError = `Bitte gib den 6-stelligen Code ein.`;
			return;
		}
		if (!validateOfferingLocation()) return;

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
			requestOfferingSubmit();
		} catch (err: unknown) {
			authError = err instanceof Error ? err.message : `Ein Fehler ist aufgetreten`;
			console.error(`Auth error:`, err);
		} finally {
			authBusy = false;
		}
	}

	function useAnotherEmail() {
		requestedStep = `offering`;
		pendingEmail = ``;
		otpCode = ``;
		authError = ``;
		resetEmailProfileCheck();
	}

	async function resendCode() {
		await sendOtpCode({ emailAddress: pendingEmail || email });
	}

	async function goNext() {
		submitError = ``;
		if (anyImageUploadInFlight) {
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return;
		}
		if (currentStep === `offering`) {
			if (!validateCurrentStep()) return;
			if (!validateOfferingLocation()) return;
			if (!isSignedIn) {
				const trimmed = email.trim();
				const hasCachedEmailCheck = checkedEmail === trimmed && emailProfileComplete !== null;
				emailCheckBusy = !hasCachedEmailCheck;
				clearEmailProfileCheckDebounce();
				try {
					const emailChecked = await checkEmailProfileStatus({ showError: true });
					if (!emailChecked) return;
				} finally {
					emailCheckBusy = false;
				}
			}
			if (profileStepApplies) {
				requestedStep = `profile`;
				return;
			}
			if (!isSignedIn) {
				await enterOtpStep();
				return;
			}
			requestOfferingSubmit();
			return;
		}
		if (currentStep === `profile`) {
			if (!validateCurrentStep()) return;
			if (!validateOfferingLocation()) return;
			if (!(await validateProfileStep())) return;
			if (!isSignedIn) {
				await enterOtpStep();
				return;
			}
			requestOfferingSubmit();
			return;
		}
		await verifyCodeAndSubmit();
	}

	function goBack() {
		const previousStep = steps[currentStepIndex - 1];
		if (!previousStep) return;
		requestedStep = previousStep.id;
	}

	function onSubmit(event: SubmitEvent) {
		submitError = ``;
		if (anyImageUploadInFlight) {
			event.preventDefault();
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return;
		}
		if (authVerified && (page.data.userId || offeringSubmitAuthToken)) {
			if (!validateOfferingLocation()) {
				event.preventDefault();
				return;
			}
			unsaved.clear();
			return;
		}
		event.preventDefault();
		void goNext();
	}

	onMount(() => {
		void initializeClient();
	});

	onDestroy(clearEmailProfileCheckDebounce);

	async function initializeClient() {
		await getSupabaseBrowserClient().auth.getSession();
		clientReady = true;
	}

	type EmailProfileCheckResult =
		| {
				ok: true;
				profileComplete: boolean;
		  }
		| {
				ok: false;
				message: string;
		  };
</script>

<svelte:head>
	<title>Angebot erstellen | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-col gap-2">
				{#if currentStep === `profile`}
					<h1 class="text-xl sm:text-2xl font-bold">Fülle dein Profil aus</h1>
					<p class="text-base-content/70 text-sm">
						Ein vollständiges Profil hilft das dir Kunden mehr vertrauen und dich besser einschätzen.
						Dein Profil wird unter jedem deiner Angebote angezeigt.
					</p>
				{:else if currentStep === `otp`}
					<h1 class="text-xl sm:text-2xl font-bold">E-Mail bestätigen</h1>
					<p class="text-base-content/70 text-sm">
						Wir haben einen 6-stelligen Code an <b>{pendingEmail}</b> gesendet. Gib ihn hier ein, um deine E-Mail zu bestätigen. Dein Angebot geht
						erst live, wenn die Bestätigung abgeschlossen ist.
					</p>
				{:else}
					<h1 class="text-xl sm:text-2xl font-bold">Angebot erstellen</h1>
					<p class="text-base-content/70 text-sm">
						Ein Angebot ist ein Dienst den du auf Anfrage bereitstellst.
						Jeder kann es in deinem Profil und auf der Angebote-Seite sehen.
					</p>
				{/if}
			</div>

			{#if clientReady}
				<OfferingForm
					remoteForm={createOffering}
					returnTo={returnHref}
					bind:format
					{fieldsHidden}
					initialLocationLabel={initialLocation?.label}
					initialLocationLat={initialLocation?.lat}
					initialLocationLng={initialLocation?.lng}
					{locationError}
					onDirty={unsaved.markDirty}
					onImageBusyChange={(busy) => (offeringImagesBusy = busy)}
					onsubmit={onSubmit}
				>
					<input type="hidden" {...createOffering.fields.authToken.as(`text`)} value={offeringSubmitAuthToken} />

					{#if showAnonymousEmailField}
						<fieldset class="fieldset" data-wizard-step="offering">
							<input
								class="input peer w-full"
								{...createOffering.fields.email.as(`email`)}
								bind:value={email}
								autocomplete="email"
								required
								placeholder="deine@email.de"
								oninput={onEmailInput}
								onblur={onEmailBlur}
							/>
							<legend class="fieldset-legend peer-aria-invalid:text-red-600">E-Mail für Login * </legend>
							<p class="label whitespace-pre-line">Nicht öffentlich. Wir senden dir einen Code, um deine E-Mail-Adresse zu verifizieren.</p>
							<FormFieldIssues field={createOffering.fields.email} />
							{#if emailCheckError}
								<p class="text-error text-xs">{emailCheckError}</p>
							{/if}
						</fieldset>
					{/if}

					{#if renderProfileFields}
						<section class={[`flex flex-col gap-5`, profileFieldsHidden && `hidden`]} data-wizard-step="profile">
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

							<div class={[`grid gap-6 sm:grid-cols-2`, !missingProfileImageUrl && !missingBannerImageUrl && `hidden`]}>
								<ProfileImageCropInput
									class={!missingProfileImageUrl ? `hidden` : ``}
									kind="profile"
									field={createOffering.fields.profile.profileImageUrl}
									initialUrl={profile?.profileImageUrl ?? ``}
									onBusyChange={(busy) => {
										profileImageBusy = busy;
										if (busy) unsaved.markDirty();
									}}
								/>

								<ProfileImageCropInput
									class={!missingBannerImageUrl ? `hidden` : ``}
									kind="banner"
									field={createOffering.fields.profile.bannerImageUrl}
									initialUrl={profile?.bannerImageUrl ?? ``}
									onBusyChange={(busy) => {
										bannerImageBusy = busy;
										if (busy) unsaved.markDirty();
									}}
								/>
							</div>

							<fieldset class={[`fieldset`, !missingBio && `hidden`]}>
								<LexicalEditor
									field={createOffering.fields.profile.bio}
									value={profile?.bio ?? ``}
									placeholder="Erzähl etwas über dich…"
									onDirty={unsaved.markDirty}
								/>
								<legend class="fieldset-legend peer-aria-invalid:text-red-600">Profilbeschreibung</legend>
								<FormFieldIssues field={createOffering.fields.profile.bio} />
							</fieldset>

							<fieldset class={[`fieldset`, !missingSocialLinks && `hidden`]}>
								<legend class="fieldset-legend">Social Links *</legend>
								<PublicProfileSocialLinksEditor
									bind:socialLinks={getSocialLinks, setSocialLinks}
									field={createOffering.fields.profile.socialLinks}
									markDirty={unsaved.markDirty}
									revalidate={() => createOffering.validate({ preflightOnly: true })}
								/>
								{#if profileSocialLinkError}
									<p class="text-error text-sm">{profileSocialLinkError}</p>
								{/if}
							</fieldset>
						</section>
					{:else if isSignedIn && currentStep === `offering`}
						<div class="alert">
							Möchtest du dein Profil bearbeiten?
							<a href={routes.editPublicProfile()} class="btn">
								<i class="icon-[ph--arrow-right] size-4"></i>
								Profil bearbeiten
							</a>
						</div>
					{/if}

					{#if showOtpStep}
						<OtpStep
							bind:otpCode
							{authBusy}
							{authError}
							onVerify={verifyCodeAndSubmit}
							onUseAnotherEmail={useAnotherEmail}
							onResendCode={resendCode}
						/>
					{/if}

					{#if submitError}
						<div class="alert alert-error bg-error/60">
							<i class="icon-[ph--warning] size-6"></i>
							<span>{submitError}</span>
						</div>
					{/if}
				</OfferingForm>
			{:else}
				<div class="flex min-h-48 items-center justify-center" role="status" aria-busy="true">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{/if}

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				{#if isFirstStep}
					<a href={returnHref} class="btn btn-ghost">Abbrechen</a>
				{:else}
					<button type="button" class="btn btn-ghost" disabled={primaryBusy} onclick={goBack}>Zurück</button>
				{/if}
				<button type="button" class="btn btn-primary" disabled={!clientReady || primaryBusy} onclick={goNext}>
					{#if anyImageUploadInFlight}
						<span class="loading loading-spinner loading-sm"></span>
						Bilder werden hochgeladen…
					{:else if emailCheckBusy}
						<span class="loading loading-spinner loading-sm"></span>
						E-Mail wird geprüft…
					{:else if authBusy}
						<span class="loading loading-spinner loading-sm"></span>
						Wird geprüft…
					{:else if createOffering.pending > 0}
						<span class="loading loading-spinner loading-sm"></span>
						Wird gespeichert…
					{:else if showOtpStep}
						E-Mail bestätigen und Angebot veröffentlichen
					{:else if isLastStep}
						Angebot erstellen
					{:else if currentStep === `profile` && !isSignedIn}
						Weiter
					{:else}
						Weiter
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

{#key currentStep}
	<div hidden {@attach scrollToTopOnStepChange}></div>
{/key}
