<script lang="ts">
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import EventForm from "$lib/components/EventForm.svelte";
	import CreateFlowProfileFields, { type CreateFlowProfileRemoteFields } from "$lib/components/CreateFlowProfileFields.svelte";
	import OtpStep from "$lib/components/OtpStep.svelte";
	import { assignCreateFlowImageClaims, CreateFlowAuth, fieldHasIssues, submitCreateFlowForm, waitForCreateFlowSubmit } from "$lib/createFlowAuth.svelte";
	import {
		clearCreateFlowDraft,
		EVENT_CREATE_DRAFT_KEY,
		loadCreateFlowResume,
		newCreateFlowDraftId,
		saveCreateFlowDraft,
		createFlowFieldText,
		createFlowResumeStep,
		readCreateFlowFormCheckedValues,
		type EventCreateDraft,
	} from "$lib/createFlowDraft";
	import { getDefaultCreateEventFieldBase } from "$lib/eventCreateDefaults";
	import { useDuplicateEventDraftToast } from "$lib/eventDuplicateDraftToast.svelte";
	import { createEvent } from "$lib/rpc/eventMutations.remote";
	import { routes } from "$lib/routes";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";
	import { UnsavedChangesGuard } from "$lib/unsavedChangesGuard.svelte";

	type WizardStep = `event` | `profile` | `otp`;
	type WizardStepItem = {
		id: WizardStep;
		label: string;
	};

	let { data } = $props();
	const isSignedIn = $derived(Boolean(page.data.userId));
	// svelte-ignore state_referenced_locally
	let profile = $state(data.profile);

	let requestedStep = $state<WizardStep>(`event`);
	let hasInitializedCreateFields = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let eventImagesBusy = $state(false);
	let eventImagesFailed = $state(false);
	let submitError = $state(``);
	let autoPublishing = $state(page.url.searchParams.get(`auth_success`) === `1`);
	let profileSocialLinkError = $state(``);
	// svelte-ignore state_referenced_locally
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);
	let restoredLocation = $state<{ label: string | null; lat: number | null; lng: number | null } | null>(null);
	let restoredDraftId = $state<string | undefined>();

	const auth = new CreateFlowAuth({
		isSignedIn: Boolean(page.data.userId),
		requireSocialLink: false,
		onSubmitAuthTokenChange: (token) => createEvent.fields.authToken.set(token),
	});
	const isAuthenticated = $derived(isSignedIn || auth.authVerified);
	const wizardProfile = $derived(profile ?? auth.emailLoadedProfile);

	const anyImageUploadInFlight = $derived(eventImagesBusy || profileImageBusy || bannerImageBusy);
	const profileFieldIssues = $derived(hasProfileFieldIssues());
	const profileIncomplete = $derived(!((profile ?? auth.emailLoadedProfile)?.displayName?.trim()));
	const profileStepApplies = $derived(isAuthenticated ? profileIncomplete || profileFieldIssues : false);
	const currentStep = $derived.by<WizardStep>(() => {
		if (profileFieldIssues && profileStepApplies) return `profile`;
		if (requestedStep === `profile` && !profileStepApplies) return `event`;
		if (requestedStep === `otp` && isSignedIn) return profileStepApplies ? `profile` : `event`;
		return requestedStep;
	});
	const steps = $derived.by<WizardStepItem[]>(() => [
		{ id: `event`, label: `Event` },
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
	const fieldsHidden = $derived(currentStep !== `event`);
	const renderProfileFields = $derived(profileStepApplies);
	const profileFieldsHidden = $derived(currentStep !== `profile`);
	const showOtpStep = $derived(currentStep === `otp` && !isSignedIn);
	const awaitingOtpCode = $derived(Boolean(auth.pendingEmail));
	const createFormHasIssues = $derived(Boolean(createEvent.fields.allIssues()?.length) || profileFieldIssues);
	const hideWizardWhilePublishing = $derived(autoPublishing && !submitError && !createFormHasIssues);
	const primaryBusy = $derived(createEvent.pending > 0 || auth.authBusy || auth.emailCheckBusy || anyImageUploadInFlight);

	const unsaved = new UnsavedChangesGuard();
	const showCreateForm = $derived((isSignedIn || auth.clientReady) && hasInitializedCreateFields);

	useDuplicateEventDraftToast(() => createEvent);

	let hasMountedWizardStep = false;
	function scrollToTopOnStepChange() {
		if (!hasMountedWizardStep) {
			hasMountedWizardStep = true;
			return;
		}
		window.scrollTo({ top: 0, behavior: `instant` });
	}

	function hasProfileFieldIssues() {
		const profileFields = createEvent.fields.profile;
		return Boolean(
			fieldHasIssues(profileFields.displayName) ||
			fieldHasIssues(profileFields.profileImageUrl) ||
			fieldHasIssues(profileFields.bannerImageUrl) ||
			fieldHasIssues(profileFields.bio) ||
			fieldHasIssues(profileFields.socialLinks),
		);
	}

	function markCreateDirty() {
		if (autoPublishing) return;
		unsaved.markDirty();
	}

	function requestEventSubmit() {
		autoPublishing = true;
		if (!isSignedIn) createEvent.fields.email.set(auth.email);
		queueMicrotask(() => (document.getElementById(`event-form`) as HTMLFormElement | null)?.requestSubmit());
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

	async function validateProfileStep() {
		profileSocialLinkError = ``;
		createEvent.fields.profile.socialLinks.set(socialLinks);
		await createEvent.validate({ includeUntouched: true, preflightOnly: true });
		return !hasProfileFieldIssues();
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
		requestEventSubmit();
	}

	async function verifyCodeAndContinue() {
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

	function snapshotEventDraft(): EventCreateDraft {
		const profileFields = createEvent.fields.profile;
		return {
			v: 1,
			kind: `event`,
			draftId: restoredDraftId ?? newCreateFlowDraftId(),
			savedAt: Date.now(),
			requestedStep,
			email: auth.email,
			socialLinks,
			fields: {
				name: createEvent.fields.name.value() ?? ``,
				description: createFlowFieldText({
					fieldValue: createEvent.fields.description.value(),
					formId: `event-form`,
					name: `description`,
				}),
				tagSlugs: (createEvent.fields.tagSlugs.value() ?? []).filter((slug): slug is string => Boolean(slug)),
				price: createEvent.fields.price.value() ?? ``,
				address: createEvent.fields.address.value() ?? ``,
				addressNote: createEvent.fields.addressNote.value() ?? ``,
				latitude: `${createEvent.fields.latitude.value() ?? ``}`,
				longitude: `${createEvent.fields.longitude.value() ?? ``}`,
				startAt: createEvent.fields.startAt.value() ?? ``,
				endAt: createEvent.fields.endAt.value() ?? ``,
				timeZone: createEvent.fields.timeZone.value() ?? ``,
				isOnline: createEvent.fields.isOnline.value() ?? false,
				isNotListed: createEvent.fields.isNotListed.value() ?? false,
				contact: createEvent.fields.contact.value() ?? ``,
				contactMethod: createEvent.fields.contactMethod.value() ?? `none`,
				imageClaims: readCreateFlowFormCheckedValues({ formId: `event-form`, testId: `image-claim` }),
				email: auth.email,
				profile: {
					displayName: profileFields.displayName.value() || profile?.displayName || ``,
					bio: createFlowFieldText({
						fieldValue: profileFields.bio.value() || profile?.bio,
						formId: `event-form`,
						name: `profile.bio`,
					}),
					profileImageUrl: profileFields.profileImageUrl.value() || profile?.profileImageUrl || ``,
					bannerImageUrl: profileFields.bannerImageUrl.value() || profile?.bannerImageUrl || ``,
					locationLabel: ``,
					latitude: ``,
					longitude: ``,
				},
			},
		};
	}

	function applyEventDraft(draft: EventCreateDraft) {
		const loaded = profile;
		auth.email = draft.email;
		socialLinks = draft.socialLinks.length ? draft.socialLinks : [...(loaded?.socialLinks ?? [])];
		restoredDraftId = draft.draftId;
		const displayName = draft.fields.profile.displayName || loaded?.displayName || ``;
		const bio = draft.fields.profile.bio || loaded?.bio || ``;
		const profileImageUrl = draft.fields.profile.profileImageUrl || loaded?.profileImageUrl || ``;
		const bannerImageUrl = draft.fields.profile.bannerImageUrl || loaded?.bannerImageUrl || ``;
		createEvent.fields.set({
			...draft.fields,
			imageClaims: draft.fields.imageClaims ?? [],
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
		const lat = Number(draft.fields.latitude);
		const lng = Number(draft.fields.longitude);
		restoredLocation = {
			label: draft.fields.address || null,
			lat: draft.fields.latitude !== `` && Number.isFinite(lat) ? lat : null,
			lng: draft.fields.longitude !== `` && Number.isFinite(lng) ? lng : null,
		};
	}

	async function startGoogleSignIn() {
		unsaved.clear();
		const draft = snapshotEventDraft();
		const draftId = draft.draftId ?? newCreateFlowDraftId();
		restoredDraftId = draftId;
		saveCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY, draft: { ...draft, draftId } });
		await auth.signInWithGoogle({ next: routes.currentPath(new URL(window.location.href)) });
	}

	function galleryBlocksSubmit() {
		if (anyImageUploadInFlight) {
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return true;
		}
		if (eventImagesFailed) {
			submitError = `Bitte behebe fehlgeschlagene Uploads oder entferne die Bilder.`;
			return true;
		}
		return false;
	}

	async function goNext() {
		submitError = ``;
		if (galleryBlocksSubmit()) return;
		if (currentStep === `event`) {
			if (!validateCurrentStep()) return;
			if (!isAuthenticated) {
				requestedStep = `otp`;
				return;
			}
			if (profileStepApplies) {
				requestedStep = `profile`;
				return;
			}
			requestEventSubmit();
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
			if (!(await validateProfileStep())) return;
			requestEventSubmit();
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
		createEvent.fields.imageClaims.set(args.imageClaims);
		const submitted = await submitCreateFlowForm({
			formId: `event-form`,
			beforeSubmit: args.imageClaims.length
				? (form) => assignCreateFlowImageClaims({ tokens: args.imageClaims, form, testId: `image-claim` })
				: undefined,
		});
		if (!submitted) {
			autoPublishing = false;
			submitError = `Event konnte nicht automatisch veröffentlicht werden. Bitte klicke auf „Event erstellen“.`;
			return;
		}
		const result = await waitForCreateFlowSubmit({ isPending: () => createEvent.pending > 0 });
		if (!autoPublishing) return;
		if (result === `idle` || submitError || createFormHasIssues) {
			autoPublishing = false;
			if (!submitError && !createFormHasIssues) {
				submitError = `Event konnte nicht automatisch veröffentlicht werden. Bitte klicke auf „Event erstellen“.`;
			}
		}
	}

	function discardCreateDraft() {
		clearCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY });
	}

	function clearDraftIfSubmitting() {
		if (createEvent.pending > 0) discardCreateDraft();
	}

	onMount(() => {
		void (async () => {
			const { draft, wasPending } = loadCreateFlowResume<EventCreateDraft>({ key: EVENT_CREATE_DRAFT_KEY });
			if (draft) {
				applyEventDraft(draft);
				requestedStep = createFlowResumeStep({
					isSignedIn,
					profileStepApplies,
					formStep: `event`,
					wasPending,
					authError: page.url.searchParams.get(`auth_error`),
				});
				hasInitializedCreateFields = true;
				void auth.initializeClient();
				if (!wasPending || !isSignedIn || profileStepApplies) {
					autoPublishing = false;
					return;
				}
				await publishRestoredDraft({ imageClaims: draft.fields.imageClaims ?? [] });
				return;
			}
			createEvent.fields.set(getDefaultCreateEventFieldBase({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
			hasInitializedCreateFields = true;
			void auth.initializeClient();
			autoPublishing = false;
		})();
	});

	onDestroy(() => {
		clearDraftIfSubmitting();
		auth.destroy();
	});
</script>

<svelte:head>
	<title>Event erstellen | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} onpagehide={clearDraftIfSubmitting} />

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 md:pb-6">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body relative gap-6 p-4 sm:p-6">
			<div class={["flex flex-col gap-6", hideWizardWhilePublishing && `invisible`]}>
			<div class="flex flex-col gap-2">
				{#if currentStep === `profile`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="create-event-heading" data-step="profile">Fülle dein Profil aus</h1>
					<p class="text-base-content/70 text-sm">
						Ein vollständiges Profil hilft, dass dir Menschen mehr vertrauen. Dein Profil wird bei deinen Events angezeigt.
					</p>
				{:else if currentStep === `otp`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="create-event-heading" data-step="otp">Anmelden</h1>
					<p class="text-base-content/70 text-sm">
						{#if awaitingOtpCode}
							Dein Event geht erst live, wenn die Anmeldung abgeschlossen ist.
						{:else}
							Melde dich mit Google an oder lass dir einen Code per E-Mail schicken. Dein Event geht erst live, wenn die
							Anmeldung abgeschlossen ist.
						{/if}
					</p>
				{:else}
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h1 class="text-xl sm:text-2xl font-bold" data-testid="create-event-heading" data-step="event">Event erstellen</h1>
						</div>
						<a href={routes.root()} class="btn btn-ghost btn-sm">
							<i class="icon-[ph--arrow-left] size-4"></i>
							Zurück
						</a>
					</div>
				{/if}
			</div>

			{#if showCreateForm}
				<EventForm
					mode="create"
					remoteForm={createEvent}
					showAutofillControl
					{fieldsHidden}
					initialLocationLabel={restoredLocation?.label}
					initialLocationLat={restoredLocation?.lat}
					initialLocationLng={restoredLocation?.lng}
					onDirty={markCreateDirty}
					onsubmit={onSubmit}
					onImageBusyChange={(busy) => (eventImagesBusy = busy)}
					onImageFailedChange={(failed) => (eventImagesFailed = failed)}
				>
					<input {...createEvent.fields.authToken.as(`text`)} type="hidden" value={auth.submitAuthToken} />
					{#if !isSignedIn}
						<input {...createEvent.fields.email.as(`text`)} type="hidden" value={auth.email} />
					{/if}

					{#if renderProfileFields}
						<CreateFlowProfileFields
							fields={createEvent.fields.profile as CreateFlowProfileRemoteFields}
							profile={wizardProfile}
							bind:socialLinks={
								() => socialLinks,
								(next) => setSocialLinks(next)
							}
							{profileSocialLinkError}
							requireSocialLink={false}
							hidden={profileFieldsHidden}
							onDirty={markCreateDirty}
							onProfileImageBusyChange={(busy) => (profileImageBusy = busy)}
							onBannerImageBusyChange={(busy) => (bannerImageBusy = busy)}
							revalidate={() => createEvent.validate({ preflightOnly: true })}
						/>
					{:else if isSignedIn && currentStep === `event`}
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
							emailTestId="event-email-input"
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
				</EventForm>
			{:else}
				<div class="flex min-h-48 items-center justify-center" role="status" aria-busy="true">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{/if}

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				{#if isFirstStep}
					<a href={routes.root()} class="btn btn-ghost">Abbrechen</a>
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
					{:else if createEvent.pending > 0}
						<span class="loading loading-spinner loading-sm"></span>
						Speichere...
					{:else if showOtpStep && !awaitingOtpCode}
						Code senden
					{:else if showOtpStep}
						Anmelden
					{:else if isLastStep}
						Event erstellen
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
						<p class="text-base-content/70">Event wird erstellt…</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

{#key currentStep}
	<div hidden {@attach scrollToTopOnStepChange}></div>
{/key}
