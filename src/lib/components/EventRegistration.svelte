<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { Dialog } from "$lib/components/dialog";
	import EventRegistrationHost from "$lib/components/EventRegistrationHost.svelte";
	import { showLoginDialog } from "$lib/components/LoginDialog.svelte";
	import {
		ANSWER_MAX_LENGTH,
		COMMENT_MAX_LENGTH,
		NAME_MAX_LENGTH,
		commentVisibilityLabel,
		type RegistrationAnswerValue,
		type RegistrationView,
	} from "$lib/registration";
	import { cancelEventRegistration, getEventRegistration, submitEventRegistration } from "$lib/rpc/registration.remote";
	import { user } from "$lib/user.svelte";

	let {
		eventId,
		hostSecret = ``,
		mode = `public`,
	}: {
		eventId: number;
		hostSecret?: string;
		mode?: `public` | `settings`;
	} = $props();

	const registrationQuery = $derived(getEventRegistration({ eventId, hostSecret }));
	const view = $derived(registrationQuery.current);

	let dialogOpen = $state(false);
	let name = $state(``);
	let email = $state(``);
	let comment = $state(``);
	let answers = $state<Record<number, RegistrationAnswerValue>>({});
	let errorMessage = $state(``);
	let confirmCancel = $state(false);

	const mineActive = $derived(view?.mine?.status === `registered` || view?.mine?.status === `waitlist`);
	const eventIsFull = $derived(
		view?.maxGuests != null && view.registeredCount != null && view.registeredCount >= view.maxGuests && view.mine?.status !== `registered`,
	);
	const registerLabel = $derived(eventIsFull ? `Auf die Warteliste` : `Anmelden`);

	function openForm(current: RegistrationView) {
		if (!user.id) {
			showLoginDialog();
			return;
		}
		name = current.mine?.name || current.suggestedName;
		email = current.mine?.email || current.suggestedEmail;
		comment = current.mine?.comment ?? ``;
		const next: Record<number, RegistrationAnswerValue> = {};
		for (const question of current.questions) {
			const existing = current.mine?.answers.find((answer) => answer.questionId === question.id);
			if (existing) {
				next[question.id] = existing.answer;
				continue;
			}
			next[question.id] = question.multipleAnswers ? [] : ``;
		}
		answers = next;
		errorMessage = ``;
		dialogOpen = true;
	}

	function textAnswer(questionId: number) {
		const value = answers[questionId];
		if (typeof value === `string`) return value;
		return ``;
	}

	function setTextAnswer(questionId: number, value: string) {
		answers[questionId] = value;
	}

	function optionChecked(questionId: number, option: string) {
		const value = answers[questionId];
		return Array.isArray(value) && value.includes(option);
	}

	function toggleOption({ questionId, option, checked }: { questionId: number; option: string; checked: boolean }) {
		const value = answers[questionId];
		const list = Array.isArray(value) ? value : [];
		answers[questionId] = checked ? [...list, option] : list.filter((entry) => entry !== option);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!view) return;
		errorMessage = ``;
		const payload = view.questions.flatMap((question) => {
			const answer = answers[question.id];
			if (answer == null) return [];
			if (typeof answer === `string` && !answer.trim()) return [];
			if (Array.isArray(answer) && !answer.length) return [];
			return [{ questionId: question.id, answer }];
		});
		const result = await submitEventRegistration({ eventId, name, email, comment, answers: payload });
		if (!result.ok) {
			errorMessage = result.message;
			return;
		}
		dialogOpen = false;
		await registrationQuery.refresh();
	}

	async function cancel() {
		if (!confirmCancel) {
			confirmCancel = true;
			return;
		}
		errorMessage = ``;
		const result = await cancelEventRegistration({ eventId });
		if (!result.ok) {
			errorMessage = result.message;
			return;
		}
		confirmCancel = false;
		await registrationQuery.refresh();
	}

	async function onHostSaved() {
		await registrationQuery.refresh();
		await invalidateAll();
	}
</script>

{#if view}
	<div class="flex w-full flex-col gap-4" data-testid="event-registration">
		{#if mode === `public` && view.registrationEnabled}
			<div class="flex w-full flex-col items-center gap-3">
				{#if mineActive && view.mine}
					<p data-testid="registration-status">
						{view.mine.status === `waitlist` ? `Du stehst auf der Warteliste.` : `Du bist angemeldet.`}
					</p>
					<div class="flex flex-wrap justify-center gap-3">
						<button type="button" class="btn" data-testid="registration-edit" onclick={() => openForm(view)}> Angaben ändern </button>
						<button
							type="button"
							class="btn"
							data-testid="registration-cancel"
							disabled={cancelEventRegistration.pending > 0}
							onclick={cancel}
						>
							{confirmCancel ? `Wirklich abmelden?` : `Abmelden`}
						</button>
					</div>
				{:else}
					<button type="button" class="btn btn-primary" data-testid="event-register-button" onclick={() => openForm(view)}>
						{registerLabel}
					</button>
				{/if}
				{#if errorMessage && !dialogOpen}
					<p class="text-error text-sm" data-testid="registration-error">{errorMessage}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-2" data-testid="guest-list">
				<h2 class="text-lg font-semibold">Gäste</h2>
				{#if view.showCount && view.registeredCount != null}
					<p data-testid="guest-list-count">{view.registeredCount} angemeldet</p>
				{/if}
				{#if view.showNames && view.guests?.length}
					<ul class="flex flex-col gap-2">
						{#each view.guests.filter((guest) => guest.status === `registered`) as guest (`registered-${guest.name}-${guest.comment ?? ``}`)}
							<li data-testid="guest-list-name">
								<span class="font-medium">{guest.name}</span>
								{#if guest.comment}
									<span class="text-base-content/70 text-sm" data-testid="guest-list-comment"> — {guest.comment}</span>
								{/if}
							</li>
						{/each}
					</ul>
					{#if view.guests.some((guest) => guest.status === `waitlist`)}
						<h3 class="font-medium">Warteliste</h3>
						<ul class="flex flex-col gap-2">
							{#each view.guests.filter((guest) => guest.status === `waitlist`) as guest (`waitlist-${guest.name}-${guest.comment ?? ``}`)}
								<li data-testid="guest-list-waitlist">{guest.name}</li>
							{/each}
						</ul>
					{/if}
				{:else if !view.showNames && !view.showCount && view.guestListVisibility === `owners`}
					<p class="text-base-content/70 text-sm" data-testid="guest-list-hidden">Die Gästeliste ist nur für den Veranstalter sichtbar.</p>
				{:else if !view.showNames && !view.showCount}
					<p class="text-base-content/70 text-sm" data-testid="guest-list-hidden">Namen sehen angemeldete Gäste.</p>
				{/if}
			</div>
		{/if}

		{#if view.isHost}
			<EventRegistrationHost {eventId} {hostSecret} {view} onSaved={onHostSaved} />
		{/if}
	</div>

	<Dialog.Root bind:open={dialogOpen}>
		<Dialog.Portal>
			<Dialog.OverlayAnimated class="z-70" />
			<Dialog.ContentAnimated
				class="bg-base-100 fixed top-1/2 left-1/2 z-70 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl"
				data-testid="registration-dialog"
			>
				<Dialog.Title class="mb-4 text-xl font-semibold">{registerLabel}</Dialog.Title>
				<form class="flex flex-col gap-4" onsubmit={submit}>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Name</legend>
						<input class="input w-full" maxlength={NAME_MAX_LENGTH} required data-testid="registration-name-input" bind:value={name} />
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">E-Mail</legend>
						<input class="input w-full" type="email" required data-testid="registration-email-input" bind:value={email} />
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Kommentar</legend>
						<textarea
							class="textarea w-full"
							maxlength={COMMENT_MAX_LENGTH}
							placeholder={commentVisibilityLabel(view.guestListVisibility)}
							data-testid="registration-comment-input"
							bind:value={comment}
						></textarea>
					</fieldset>

					{#each view.questions as question, index (question.id)}
						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								{question.text}{question.mandatory ? ` *` : ``}
							</legend>
							{#if question.description}
								<p class="label">{question.description}</p>
							{/if}
							{#if question.possibleAnswers.length && question.multipleAnswers}
								{#each question.possibleAnswers as option, optionIndex (option)}
									<label class="flex items-center gap-3">
										<input
											type="checkbox"
											class="checkbox"
											data-testid={`registration-question-${index}-option-${optionIndex}`}
											checked={optionChecked(question.id, option)}
											onchange={(event) => toggleOption({ questionId: question.id, option, checked: event.currentTarget.checked })}
										/>
										<span>{option}</span>
									</label>
								{/each}
							{:else if question.possibleAnswers.length}
								<select
									class="select w-full"
									data-testid={`registration-question-${index}`}
									value={textAnswer(question.id)}
									onchange={(event) => setTextAnswer(question.id, event.currentTarget.value)}
								>
									<option value="">{question.mandatory ? `Bitte wählen` : `Keine Angabe`}</option>
									{#each question.possibleAnswers as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							{:else}
								<textarea
									class="textarea w-full"
									maxlength={ANSWER_MAX_LENGTH}
									data-testid={`registration-question-${index}`}
									value={textAnswer(question.id)}
									oninput={(event) => setTextAnswer(question.id, event.currentTarget.value)}
								></textarea>
							{/if}
						</fieldset>
					{/each}

					{#if errorMessage}
						<p class="text-error text-sm" data-testid="registration-error">{errorMessage}</p>
					{/if}
					<button class="btn btn-primary" type="submit" data-testid="registration-submit" disabled={submitEventRegistration.pending > 0}>
						{submitEventRegistration.pending > 0 ? `Speichert…` : registerLabel}
					</button>
				</form>
				<Dialog.Close
					class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full"
					aria-label="Schließen"
					data-testid="registration-dialog-close"
				>
					<i class="icon-[ph--x] size-6"></i>
				</Dialog.Close>
			</Dialog.ContentAnimated>
		</Dialog.Portal>
	</Dialog.Root>
{/if}
