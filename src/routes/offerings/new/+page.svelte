<script lang="ts">
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import CreateFlowProfileFields, { type CreateFlowProfileRemoteFields } from "$lib/components/CreateFlowProfileFields.svelte";
	import OtpStep from "$lib/components/OtpStep.svelte";
	import { CreateFlowAuth, fieldHasIssues } from "$lib/createFlowAuth.svelte";
	import { offeringNeedsLocation, type OfferingFormat } from "$lib/rpc/offerings.common";
	import { createOffering } from "$lib/rpc/offerings.remote";
	import { profileLocationCheckMessage, type PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { hasValidCoordinates } from "$lib/locationFilter";
	import { routes, safeReturnToPath } from "$lib/routes";
	import { UnsavedChangesGuard } from "$lib/unsavedChangesGuard.svelte";
	import { loadFiltersFromBrowserCookie } from "$lib/cookie-utils";

	type WizardStep = `offering` | `profile` | `otp`;
	type WizardStepItem = {
		id: WizardStep;
		label: string;
	};

	let { data } = $props();
	const isSignedIn = Boolean(page.data.userId);
	// svelte-ignore state_referenced_locally
	let profile = $state(data.profile);
	const missingDisplayName = !profile?.displayName?.trim();
	const missingSocialLinks = !profile?.socialLinks?.some((link) => link.value?.trim());
	const signedInProfileIncomplete = missingDisplayName || missingSocialLinks;

	let requestedStep = $state<WizardStep>(`offering`);
	let format = $state<OfferingFormat>(`offline`);
	let offeringImagesBusy = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let submitError = $state(``);
	let locationError = $state(``);
	let profileSocialLinkError = $state(``);
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);

	const auth = new CreateFlowAuth({
		isSignedIn,
		onSubmitAuthTokenChange: (token) => createOffering.fields.authToken.set(token),
	});
	const wizardProfile = $derived(profile ?? auth.emailLoadedProfile);

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
		isSignedIn ? signedInProfileIncomplete || profileFieldIssues : auth.emailProfileComplete !== true || profileFieldIssues,
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
	const primaryBusy = $derived(createOffering.pending > 0 || auth.authBusy || auth.emailCheckBusy || anyImageUploadInFlight);
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
				if (control.disabled || control.type === `hidden` || control.closest(`.hidden, [hidden]`)) continue;
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
			locationError = profileLocationCheckMessage;
			return false;
		}
		locationError = ``;
		return true;
	}

	function hasSocialLink(links: PublicProfileSocialLinks) {
		return links.some((link) => link.value?.trim());
	}

	function setSocialLinks(nextSocialLinks: PublicProfileSocialLinks) {
		socialLinks = nextSocialLinks;
		unsaved.markDirty();
		if (!hasSocialLink(nextSocialLinks)) return;
		profileSocialLinkError = ``;
	}

	async function enterOtpStep() {
		const sent = await auth.enterOtpStep();
		if (!sent) {
			submitError = auth.authError;
			return;
		}
		requestedStep = `otp`;
	}

	async function verifyCodeAndSubmit() {
		if (!validateOfferingLocation()) return;
		const verified = await auth.verifyCode();
		if (!verified) return;
		if (!page.data.userId && !auth.submitAuthToken) {
			auth.authError = `Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.`;
			return;
		}
		requestOfferingSubmit();
	}

	function useAnotherEmail() {
		requestedStep = `offering`;
		auth.useAnotherEmail();
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
				const trimmed = auth.email.trim();
				const hasCachedEmailCheck = auth.checkedEmail === trimmed && auth.emailProfileComplete !== null;
				auth.emailCheckBusy = !hasCachedEmailCheck;
				auth.clearEmailProfileCheckDebounce();
				try {
					const emailChecked = await auth.checkEmailProfileStatus({ showError: true });
					if (!emailChecked) return;
				} finally {
					auth.emailCheckBusy = false;
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
		if (auth.authVerified && (page.data.userId || auth.submitAuthToken)) {
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
		void auth.initializeClient();
	});

	onDestroy(() => auth.destroy());
</script>

<svelte:head>
	<title>Angebot hinzufügen | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-col gap-2">
				{#if currentStep === `profile`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="profile">Fülle dein Profil aus</h1>
					<p class="text-base-content/70 text-sm">
						Ein vollständiges Profil hilft das dir Kunden mehr vertrauen und dich besser einschätzen.
						Dein Profil wird unter jedem deiner Angebote angezeigt.
					</p>
				{:else if currentStep === `otp`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="otp">E-Mail bestätigen</h1>
					<p class="text-base-content/70 text-sm">
						Wir haben einen 6-stelligen Code an <b>{auth.pendingEmail}</b> gesendet. Gib ihn hier ein, um deine E-Mail zu bestätigen. Dein Angebot geht
						erst live, wenn die Bestätigung abgeschlossen ist.
					</p>
				{:else}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="offering">Angebot hinzufügen</h1>
					<p class="text-base-content/70 text-sm">
						Ein Angebot ist ein Dienst den du auf Anfrage bereitstellst.
						Jeder kann es in deinem Profil und auf der Angebote-Seite sehen.
					</p>
				{/if}
			</div>

			{#if auth.clientReady}
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
					<input type="hidden" {...createOffering.fields.authToken.as(`text`)} value={auth.submitAuthToken} />

					{#if showAnonymousEmailField}
						<fieldset class="fieldset" data-wizard-step="offering">
							<input
								class="input peer w-full"
								data-testid="offering-email-input"
								{...createOffering.fields.email.as(`email`)}
								bind:value={auth.email}
								autocomplete="email"
								required
								placeholder="deine@email.de"
								oninput={(event) => auth.onEmailInput(event)}
								onblur={() => auth.onEmailBlur()}
							/>
							<legend class="fieldset-legend peer-aria-invalid:text-red-600">E-Mail für Login * </legend>
							<p class="label whitespace-pre-line">Nicht öffentlich. Wir senden dir einen Code, um deine E-Mail-Adresse zu verifizieren.</p>
							<FormFieldIssues field={createOffering.fields.email} />
							{#if auth.emailCheckError}
								<p class="text-error text-xs">{auth.emailCheckError}</p>
							{/if}
						</fieldset>
					{/if}

					{#if renderProfileFields}
						<CreateFlowProfileFields
							fields={createOffering.fields.profile as CreateFlowProfileRemoteFields}
							profile={wizardProfile}
							bind:socialLinks={
								() => socialLinks,
								(next) => setSocialLinks(next)
							}
							{profileSocialLinkError}
							hidden={profileFieldsHidden}
							onDirty={unsaved.markDirty}
							onProfileImageBusyChange={(busy) => (profileImageBusy = busy)}
							onBannerImageBusyChange={(busy) => (bannerImageBusy = busy)}
							revalidate={() => createOffering.validate({ preflightOnly: true })}
						/>
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
							bind:otpCode={
								() => auth.otpCode,
								(value) => (auth.otpCode = value)
							}
							authBusy={auth.authBusy}
							authError={auth.authError}
							onVerify={verifyCodeAndSubmit}
							onUseAnotherEmail={useAnotherEmail}
							onResendCode={() => auth.resendCode()}
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
				<button type="button" class="btn btn-primary" data-testid="wizard-primary" disabled={!auth.clientReady || primaryBusy} onclick={goNext}>
					{#if anyImageUploadInFlight}
						<span class="loading loading-spinner loading-sm"></span>
						Bilder werden hochgeladen…
					{:else if auth.emailCheckBusy}
						<span class="loading loading-spinner loading-sm"></span>
						E-Mail wird geprüft…
					{:else if auth.authBusy}
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
