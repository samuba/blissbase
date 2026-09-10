<script lang="ts">
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import OfferingForm from "$lib/components/OfferingForm.svelte";
	import CreateFlowProfileFields, { type CreateFlowProfileRemoteFields } from "$lib/components/CreateFlowProfileFields.svelte";
	import OtpStep from "$lib/components/OtpStep.svelte";
	import { assignCreateFlowImageClaims, CreateFlowAuth, fieldHasIssues, submitCreateFlowForm, waitForCreateFlowSubmit } from "$lib/createFlowAuth.svelte";
	import {
		clearCreateFlowDraft,
		loadCreateFlowResume,
		newCreateFlowDraftId,
		OFFERING_CREATE_DRAFT_KEY,
		saveCreateFlowDraft,
		createFlowFieldText,
		createFlowResumeStep,
		readCreateFlowFormCheckedValues,
		type OfferingCreateDraft,
	} from "$lib/createFlowDraft";
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
	const isSignedIn = $derived(Boolean(page.data.userId));
	// svelte-ignore state_referenced_locally
	let profile = $state(data.profile);
	let requestedStep = $state<WizardStep>(`offering`);
	let hasInitializedCreateFields = $state(false);
	let format = $state<OfferingFormat>(`offline`);
	let offeringImagesBusy = $state(false);
	let offeringImagesFailed = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let submitError = $state(``);
	let autoPublishing = $state(page.url.searchParams.get(`auth_success`) === `1`);
	let locationError = $state(``);
	let profileSocialLinkError = $state(``);
	// svelte-ignore state_referenced_locally
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);
	let restoredLocation = $state<{ lat: number; lng: number; label: string | null } | undefined>();
	let restoredDraftId = $state<string | undefined>();

	const auth = new CreateFlowAuth({
		isSignedIn: Boolean(page.data.userId),
		onSubmitAuthTokenChange: (token) => createOffering.fields.authToken.set(token),
	});
	const isAuthenticated = $derived(isSignedIn || auth.authVerified);
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
	const profileIncomplete = $derived.by(() => {
		const source = profile ?? auth.emailLoadedProfile;
		if (!source?.displayName?.trim()) return true;
		return !hasSocialLink(source.socialLinks ?? []);
	});
	const profileStepApplies = $derived(isAuthenticated ? profileIncomplete || profileFieldIssues : false);
	const currentStep = $derived.by<WizardStep>(() => {
		if (profileFieldIssues && profileStepApplies) return `profile`;
		if (requestedStep === `profile` && !profileStepApplies) return `offering`;
		if (requestedStep === `otp` && isSignedIn) return profileStepApplies ? `profile` : `offering`;
		return requestedStep;
	});
	const steps = $derived.by<WizardStepItem[]>(() => [
		{ id: `offering`, label: `Angebot` },
		...(!isAuthenticated || requestedStep === `otp` ? [{ id: `otp`, label: `Anmelden` } satisfies WizardStepItem] : []),
		...(profileStepApplies ? [{ id: `profile`, label: `Profil` } satisfies WizardStepItem] : []),
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
	const renderProfileFields = $derived(profileStepApplies);
	const profileFieldsHidden = $derived(currentStep !== `profile`);
	const showOtpStep = $derived(currentStep === `otp` && !isSignedIn);
	const awaitingOtpCode = $derived(Boolean(auth.pendingEmail));
	const createFormHasIssues = $derived(Boolean(createOffering.fields.allIssues()?.length) || profileFieldIssues);
	const hideWizardWhilePublishing = $derived(autoPublishing && !submitError && !createFormHasIssues);
	const primaryBusy = $derived(createOffering.pending > 0 || auth.authBusy || auth.emailCheckBusy || anyImageUploadInFlight);
	const returnHref = $derived(
		safeReturnToPath({
			returnTo: page.url.searchParams.get(`returnTo`),
			fallback: routes.offeringsList(),
			origin: page.url.origin,
		}),
	);

	const unsaved = new UnsavedChangesGuard();
	const showCreateForm = $derived((isSignedIn || auth.clientReady) && hasInitializedCreateFields);

	let hasMountedWizardStep = false;
	function scrollToTopOnStepChange() {
		if (!hasMountedWizardStep) {
			hasMountedWizardStep = true;
			return;
		}
		window.scrollTo({ top: 0, behavior: `instant` });
	}

	const initialLocation = $derived.by(() => {
		if (restoredLocation) return restoredLocation;
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

	function markCreateDirty() {
		if (autoPublishing) return;
		unsaved.markDirty();
	}

	function requestOfferingSubmit() {
		autoPublishing = true;
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

	async function sendAuthCode() {
		if (!validateCurrentStep()) return false;
		const trimmed = auth.email.trim();
		const hasCachedEmailCheck = auth.checkedEmail === trimmed && auth.emailProfileComplete !== null;
		auth.emailCheckBusy = !hasCachedEmailCheck;
		auth.clearEmailProfileCheckDebounce();
		try {
			const emailChecked = await auth.checkEmailProfileStatus({ showError: true });
			if (!emailChecked) return false;
		} finally {
			auth.emailCheckBusy = false;
		}
		if (auth.emailLoadedProfile?.socialLinks?.length && !hasSocialLink(socialLinks)) {
			socialLinks = auth.emailLoadedProfile.socialLinks;
		}
		const sent = await auth.sendOtpCode();
		if (!sent) {
			submitError = auth.authError;
			return false;
		}
		return true;
	}

	async function continueAfterAuth() {
		if (!page.data.userId && !auth.submitAuthToken) {
			autoPublishing = false;
			auth.authError = `Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.`;
			return;
		}
		if (profileStepApplies) {
			autoPublishing = false;
			requestedStep = `profile`;
			return;
		}
		requestOfferingSubmit();
	}

	async function verifyCodeAndContinue() {
		if (!validateOfferingLocation()) return;
		autoPublishing = true;
		submitError = ``;
		const verified = await auth.verifyCode();
		if (!verified) {
			autoPublishing = false;
			return;
		}
		await continueAfterAuth();
	}

	function useAnotherEmail() {
		auth.useAnotherEmail();
	}

	function snapshotOfferingDraft(): OfferingCreateDraft {
		const profileFields = createOffering.fields.profile;
		const loaded = profile;
		return {
			v: 1,
			kind: `offering`,
			draftId: restoredDraftId ?? newCreateFlowDraftId(),
			savedAt: Date.now(),
			requestedStep,
			format,
			email: auth.email,
			socialLinks,
			fields: {
				title: createOffering.fields.title.value() ?? ``,
				descriptionHtml: createFlowFieldText({
					fieldValue: createOffering.fields.descriptionHtml.value(),
					formId: `offering-form`,
					name: `descriptionHtml`,
				}),
				format,
				imageClaims: readCreateFlowFormCheckedValues({ formId: `offering-form`, testId: `offering-image-claim` }),
				email: auth.email,
				returnTo: returnHref,
				profile: {
					displayName: profileFields.displayName.value() || loaded?.displayName || ``,
					bio: createFlowFieldText({
						fieldValue: profileFields.bio.value() || loaded?.bio,
						formId: `offering-form`,
						name: `profile.bio`,
					}),
					profileImageUrl: profileFields.profileImageUrl.value() || loaded?.profileImageUrl || ``,
					bannerImageUrl: profileFields.bannerImageUrl.value() || loaded?.bannerImageUrl || ``,
					locationLabel: profileFields.locationLabel.value() ?? ``,
					latitude: `${profileFields.latitude.value() ?? ``}`,
					longitude: `${profileFields.longitude.value() ?? ``}`,
				},
			},
		};
	}

	function applyOfferingDraft(draft: OfferingCreateDraft) {
		const loaded = profile;
		format = draft.format;
		auth.email = draft.email;
		socialLinks = draft.socialLinks.length ? draft.socialLinks : [...(loaded?.socialLinks ?? [])];
		restoredDraftId = draft.draftId;
		const displayName = draft.fields.profile.displayName || loaded?.displayName || ``;
		const bio = draft.fields.profile.bio || loaded?.bio || ``;
		const profileImageUrl = draft.fields.profile.profileImageUrl || loaded?.profileImageUrl || ``;
		const bannerImageUrl = draft.fields.profile.bannerImageUrl || loaded?.bannerImageUrl || ``;
		createOffering.fields.set({
			...draft.fields,
			authToken: ``,
			profile: {
				...draft.fields.profile,
				displayName,
				bio,
				profileImageUrl,
				bannerImageUrl,
			},
		});
		if (loaded) {
			profile = {
				...loaded,
				displayName,
				bio,
				profileImageUrl,
				bannerImageUrl,
				socialLinks: socialLinks.length ? socialLinks : loaded.socialLinks,
			};
		}
		const lat = Number(draft.fields.profile.latitude);
		const lng = Number(draft.fields.profile.longitude);
		if (draft.fields.profile.latitude !== `` && draft.fields.profile.longitude !== `` && Number.isFinite(lat) && Number.isFinite(lng)) {
			restoredLocation = {
				lat,
				lng,
				label: draft.fields.profile.locationLabel || null,
			};
		}
	}

	async function startGoogleSignIn() {
		unsaved.clear();
		const draft = snapshotOfferingDraft();
		restoredDraftId = draft.draftId;
		saveCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, draft });
		await auth.signInWithGoogle({ next: routes.currentPath(new URL(window.location.href)) });
	}

	function galleryBlocksSubmit() {
		if (anyImageUploadInFlight) {
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return true;
		}
		if (offeringImagesFailed) {
			submitError = `Bitte behebe fehlgeschlagene Uploads oder entferne die Bilder.`;
			return true;
		}
		return false;
	}

	async function goNext() {
		submitError = ``;
		if (galleryBlocksSubmit()) return;
		if (currentStep === `offering`) {
			if (!validateCurrentStep()) return;
			if (!validateOfferingLocation()) return;
			if (!isAuthenticated) {
				requestedStep = `otp`;
				return;
			}
			if (profileStepApplies) {
				requestedStep = `profile`;
				return;
			}
			requestOfferingSubmit();
			return;
		}
		if (currentStep === `otp`) {
			if (!awaitingOtpCode) {
				await sendAuthCode();
				return;
			}
			await verifyCodeAndContinue();
			return;
		}
		if (currentStep === `profile`) {
			if (!validateCurrentStep()) return;
			if (!validateOfferingLocation()) return;
			if (!(await validateProfileStep())) return;
			requestOfferingSubmit();
		}
	}

	function goBack() {
		const previousStep = steps[currentStepIndex - 1];
		if (!previousStep) return;
		requestedStep = previousStep.id;
	}

	function onSubmit(event: SubmitEvent) {
		submitError = ``;
		if (galleryBlocksSubmit()) {
			event.preventDefault();
			autoPublishing = false;
			return;
		}
		if (isSignedIn || (auth.authVerified && (page.data.userId || auth.submitAuthToken))) {
			if (!validateOfferingLocation()) {
				event.preventDefault();
				autoPublishing = false;
				return;
			}
			autoPublishing = true;
			unsaved.clear();
			discardCreateDraft();
			return;
		}
		event.preventDefault();
		autoPublishing = false;
		void goNext();
	}

	async function publishRestoredDraft(args: { imageClaims: string[] }) {
		autoPublishing = true;
		unsaved.clear();
		createOffering.fields.imageClaims.set(args.imageClaims);
		const submitted = await submitCreateFlowForm({
			formId: `offering-form`,
			beforeSubmit: args.imageClaims.length
				? (form) => assignCreateFlowImageClaims({ tokens: args.imageClaims, form, testId: `offering-image-claim` })
				: undefined,
		});
		if (!submitted) {
			autoPublishing = false;
			submitError = `Angebot konnte nicht automatisch veröffentlicht werden. Bitte klicke auf „Angebot erstellen“.`;
			return;
		}
		const result = await waitForCreateFlowSubmit({ isPending: () => createOffering.pending > 0 });
		if (!autoPublishing) return;
		if (result === `idle` || submitError || createFormHasIssues) {
			autoPublishing = false;
			if (!submitError && !createFormHasIssues) {
				submitError = `Angebot konnte nicht automatisch veröffentlicht werden. Bitte klicke auf „Angebot erstellen“.`;
			}
		}
	}

	function discardCreateDraft() {
		clearCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY });
	}

	function clearDraftIfSubmitting() {
		if (createOffering.pending > 0) discardCreateDraft();
	}

	onMount(() => {
		void (async () => {
			const { draft, wasPending } = loadCreateFlowResume<OfferingCreateDraft>({ key: OFFERING_CREATE_DRAFT_KEY });
			if (draft) {
				applyOfferingDraft(draft);
				requestedStep = createFlowResumeStep({
					isSignedIn,
					profileStepApplies,
					formStep: `offering`,
					wasPending,
					authError: page.url.searchParams.get(`auth_error`),
				});
			}
			hasInitializedCreateFields = true;
			void auth.initializeClient();
			if (!draft || !wasPending || !isSignedIn) {
				autoPublishing = false;
				return;
			}
			if (profileStepApplies) {
				autoPublishing = false;
				return;
			}
			const imageClaims = (draft.fields.imageClaims ?? []).filter((token): token is string => Boolean(token));
			await publishRestoredDraft({ imageClaims });
		})();
	});

	onDestroy(() => {
		clearDraftIfSubmitting();
		auth.destroy();
	});
</script>

<svelte:head>
	<title>Angebot hinzufügen | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} onpagehide={clearDraftIfSubmitting} />

<div class="mx-auto w-full max-w-3xl px-0 pb-6 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body relative gap-6 p-4 sm:p-6">
			<div class={["flex flex-col gap-6", hideWizardWhilePublishing && `invisible`]}>
			<div class="flex flex-col gap-2">
				{#if currentStep === `profile`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="profile">Fülle dein Profil aus</h1>
					<p class="text-base-content/70 text-sm">
						Ein vollständiges Profil hilft das dir Kunden mehr vertrauen und dich besser einschätzen.
						Dein Profil wird unter jedem deiner Angebote angezeigt.
					</p>
				{:else if currentStep === `otp`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="otp">Anmelden</h1>
					<p class="text-base-content/70 text-sm">
						{#if awaitingOtpCode}
							Dein Angebot geht erst live, wenn die Anmeldung abgeschlossen ist.
						{:else}
							Melde dich mit Google an oder lass dir einen Code per E-Mail schicken. Dein Angebot geht erst live, wenn die
							Anmeldung abgeschlossen ist.
						{/if}
					</p>
				{:else}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="offering-wizard-heading" data-step="offering">Angebot hinzufügen</h1>
					<p class="text-base-content/70 text-sm">
						Ein Angebot ist ein Dienst den du auf Anfrage bereitstellst.
						Jeder kann es in deinem Profil und auf der Angebote-Seite sehen.
					</p>
				{/if}
			</div>

			{#if showCreateForm}
				<OfferingForm
					remoteForm={createOffering}
					returnTo={returnHref}
					bind:format
					{fieldsHidden}
					initialLocationLabel={initialLocation?.label}
					initialLocationLat={initialLocation?.lat}
					initialLocationLng={initialLocation?.lng}
					{locationError}
					onDirty={markCreateDirty}
					onImageBusyChange={(busy) => (offeringImagesBusy = busy)}
					onImageFailedChange={(failed) => (offeringImagesFailed = failed)}
					onsubmit={onSubmit}
				>
					<input type="hidden" {...createOffering.fields.authToken.as(`text`)} value={auth.submitAuthToken} />
					{#if !isSignedIn}
						<input type="hidden" {...createOffering.fields.email.as(`text`)} value={auth.email} />
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
							onDirty={markCreateDirty}
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
							bind:email={
								() => auth.email,
								(value) => (auth.email = value)
							}
							bind:otpCode={
								() => auth.otpCode,
								(value) => (auth.otpCode = value)
							}
							pendingEmail={auth.pendingEmail}
							authBusy={auth.authBusy}
							authError={auth.authError}
							emailCheckError={auth.emailCheckError}
							emailTestId="offering-email-input"
							onVerify={verifyCodeAndContinue}
							onUseAnotherEmail={useAnotherEmail}
							onResendCode={() => auth.resendCode()}
							onGoogleSignIn={startGoogleSignIn}
							onEmailInput={(event) => auth.onEmailInput(event)}
							onEmailBlur={() => auth.onEmailBlur()}
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
				<button type="button" class="btn btn-primary" data-testid="wizard-primary" disabled={!showCreateForm || primaryBusy} onclick={goNext}>
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
					{:else if showOtpStep && !awaitingOtpCode}
						Code senden
					{:else if showOtpStep}
						Anmelden
					{:else if isLastStep}
						Angebot erstellen
					{:else}
						Weiter
					{/if}
				</button>
			</div>
			</div>
			{#if hideWizardWhilePublishing}
				<div class="bg-base-100 absolute inset-0 z-50 flex items-center justify-center" role="status" aria-busy="true" data-testid="create-flow-publishing">
					<div class="flex flex-col items-center gap-3">
						<span class="loading loading-spinner loading-lg"></span>
						<p class="text-base-content/70">Angebot wird erstellt…</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

{#key currentStep}
	<div hidden {@attach scrollToTopOnStepChange}></div>
{/key}
