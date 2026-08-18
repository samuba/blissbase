<script lang="ts">
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import EventForm from "$lib/components/EventForm.svelte";
	import CreateFlowProfileFields, { type CreateFlowProfileRemoteFields } from "$lib/components/CreateFlowProfileFields.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import OtpStep from "$lib/components/OtpStep.svelte";
	import { CreateFlowAuth, fieldHasIssues } from "$lib/createFlowAuth.svelte";
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
	const signedInProfileIncomplete = !profile?.displayName?.trim();

	let requestedStep = $state<WizardStep>(`event`);
	let hasInitializedCreateFields = $state(false);
	let profileImageBusy = $state(false);
	let bannerImageBusy = $state(false);
	let submitError = $state(``);
	let profileSocialLinkError = $state(``);
	let socialLinks = $state([...(profile?.socialLinks ?? [])] as PublicProfileSocialLinks);

	const auth = new CreateFlowAuth({
		isSignedIn,
		requireSocialLink: false,
		onSubmitAuthTokenChange: (token) => createEvent.fields.authToken.set(token),
	});
	const wizardProfile = $derived(profile ?? auth.emailLoadedProfile);

	const anyImageUploadInFlight = $derived(profileImageBusy || bannerImageBusy);
	const profileFieldIssues = $derived(hasProfileFieldIssues());
	const profileStepApplies = $derived(
		isSignedIn ? signedInProfileIncomplete || profileFieldIssues : auth.emailProfileComplete !== true || profileFieldIssues,
	);
	const currentStep = $derived.by<WizardStep>(() => {
		if (profileFieldIssues && profileStepApplies) return `profile`;
		if (requestedStep === `profile` && !profileStepApplies) return `event`;
		if (requestedStep === `otp` && isSignedIn) return `event`;
		return requestedStep;
	});
	const steps = $derived.by<WizardStepItem[]>(() => [
		{ id: `event`, label: `Event` },
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
	const fieldsHidden = $derived(currentStep !== `event`);
	const showAnonymousEmailField = $derived(!isSignedIn && currentStep === `event`);
	const renderProfileFields = $derived(profileStepApplies);
	const profileFieldsHidden = $derived(currentStep !== `profile`);
	const showOtpStep = $derived(currentStep === `otp` && !isSignedIn);
	const primaryBusy = $derived(createEvent.pending > 0 || auth.authBusy || auth.emailCheckBusy || anyImageUploadInFlight);

	const unsaved = new UnsavedChangesGuard();

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

	function requestEventSubmit() {
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

	async function enterOtpStep() {
		const sent = await auth.enterOtpStep();
		if (!sent) {
			submitError = auth.authError;
			return;
		}
		requestedStep = `otp`;
	}

	async function verifyCodeAndSubmit() {
		const verified = await auth.verifyCode();
		if (!verified) return;
		if (!page.data.userId && !auth.submitAuthToken) {
			auth.authError = `Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.`;
			return;
		}
		requestEventSubmit();
	}

	function useAnotherEmail() {
		requestedStep = `event`;
		auth.useAnotherEmail();
	}

	async function goNext() {
		submitError = ``;
		if (anyImageUploadInFlight) {
			submitError = `Bitte warte, bis alle Bilder hochgeladen sind.`;
			return;
		}
		if (currentStep === `event`) {
			if (!validateCurrentStep()) return;
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
			requestEventSubmit();
			return;
		}
		if (currentStep === `profile`) {
			if (!validateCurrentStep()) return;
			if (!(await validateProfileStep())) return;
			if (!isSignedIn) {
				await enterOtpStep();
				return;
			}
			requestEventSubmit();
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
			unsaved.clear();
			return;
		}
		event.preventDefault();
		void goNext();
	}

	onMount(() => {
		createEvent.fields.set(getDefaultCreateEventFieldBase({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
		hasInitializedCreateFields = true;
		void auth.initializeClient();
	});

	onDestroy(() => auth.destroy());
</script>

<svelte:head>
	<title>Event erstellen | Blissbase</title>
</svelte:head>

<svelte:window onbeforeunload={unsaved.handleBeforeUnload} />

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 md:pb-6">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-6 p-4 sm:p-6">
			<div class="flex flex-col gap-2">
				{#if currentStep === `profile`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="create-event-heading" data-step="profile">Fülle dein Profil aus</h1>
					<p class="text-base-content/70 text-sm">
						Ein vollständiges Profil hilft, dass dir Menschen mehr vertrauen. Dein Profil wird bei deinen Events angezeigt.
					</p>
				{:else if currentStep === `otp`}
					<h1 class="text-xl sm:text-2xl font-bold" data-testid="create-event-heading" data-step="otp">E-Mail bestätigen</h1>
					<p class="text-base-content/70 text-sm">
						Wir haben einen 6-stelligen Code an <b>{auth.pendingEmail}</b> gesendet. Gib ihn hier ein, um deine E-Mail zu bestätigen. Dein Event geht
						erst live, wenn die Bestätigung abgeschlossen ist.
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

			{#if auth.clientReady && hasInitializedCreateFields}
				<EventForm
					mode="create"
					remoteForm={createEvent}
					allTags={data.tags.allTags}
					showAutofillControl
					{fieldsHidden}
					onDirty={unsaved.markDirty}
					onsubmit={onSubmit}
				>
					<input {...createEvent.fields.authToken.as(`text`)} type="hidden" value={auth.submitAuthToken} />
					{#if !isSignedIn && !showAnonymousEmailField}
						<input {...createEvent.fields.email.as(`text`)} type="hidden" value={auth.email} />
					{/if}

					{#if showAnonymousEmailField}
						<fieldset class="fieldset" data-wizard-step="event">
							<input
								class="input peer w-full"
								data-testid="event-email-input"
								{...createEvent.fields.email.as(`email`)}
								bind:value={auth.email}
								autocomplete="email"
								required
								placeholder="deine@email.de"
								oninput={(event) => auth.onEmailInput(event)}
								onblur={() => auth.onEmailBlur()}
							/>
							<legend class="fieldset-legend peer-aria-invalid:text-red-600">E-Mail für Login * </legend>
							<p class="label whitespace-pre-line">Nicht öffentlich. Wir senden dir einen Code, um deine E-Mail-Adresse zu verifizieren.</p>
							<FormFieldIssues field={createEvent.fields.email} />
							{#if auth.emailCheckError}
								<p class="text-error text-xs">{auth.emailCheckError}</p>
							{/if}
						</fieldset>
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
							onDirty={unsaved.markDirty}
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
				<button type="button" class="btn btn-primary" data-testid="wizard-primary" disabled={!auth.clientReady || !hasInitializedCreateFields || primaryBusy} onclick={goNext}>
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
					{:else if showOtpStep}
						E-Mail bestätigen und Event veröffentlichen
					{:else if isLastStep}
						Event erstellen
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
