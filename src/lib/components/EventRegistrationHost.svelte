<script lang="ts">
	import { untrack } from "svelte";
	import { saveEventRegistrationSettings } from "$lib/rpc/registration.remote";
	import {
		GUEST_LIST_VISIBILITIES,
		GUEST_LIST_VISIBILITY_LABELS,
		formatRegistrationAnswer,
		type GuestListVisibility,
		type RegistrationStatus,
		type RegistrationView,
	} from "$lib/registration";

	let {
		eventId,
		hostSecret = ``,
		view,
		onSaved,
	}: {
		eventId: number;
		hostSecret?: string;
		view: RegistrationView;
		onSaved: () => void;
	} = $props();

	const initial = untrack(() => view);
	let registrationEnabled = $state(initial.registrationEnabled);
	let guestListVisibility = $state<GuestListVisibility>(initial.guestListVisibility);
	let maxGuests = $state(initial.maxGuests == null ? `` : String(initial.maxGuests));
	let waitlistAutoMoveUp = $state(initial.waitlistAutoMoveUp);
	let questions = $state<QuestionDraft[]>(initial.questions.map(toDraft));
	let errorMessage = $state(``);

	const statusLabel: Record<RegistrationStatus, string> = {
		registered: `Angemeldet`,
		waitlist: `Warteliste`,
		cancelled: `Abgemeldet`,
	};

	function toDraft(question: RegistrationView[`questions`][number]): QuestionDraft {
		return {
			clientKey: `q-${question.id}`,
			id: question.id,
			text: question.text,
			description: question.description ?? ``,
			mandatory: question.mandatory,
			multipleAnswers: question.multipleAnswers,
			possibleAnswers: question.possibleAnswers.length ? [...question.possibleAnswers] : [``],
		};
	}

	function addQuestion() {
		questions.push({
			clientKey: `new-${crypto.randomUUID()}`,
			id: null,
			text: ``,
			description: ``,
			mandatory: false,
			multipleAnswers: false,
			possibleAnswers: [``],
		});
	}

	function removeQuestion(index: number) {
		questions.splice(index, 1);
	}

	function moveQuestion(index: number, direction: -1 | 1) {
		const next = index + direction;
		if (next < 0 || next >= questions.length) return;
		const copy = [...questions];
		const current = copy[index];
		const target = copy[next];
		if (!current || !target) return;
		copy[index] = target;
		copy[next] = current;
		questions = copy;
	}

	function addAnswer(index: number) {
		questions[index]?.possibleAnswers.push(``);
	}

	function removeAnswer(questionIndex: number, answerIndex: number) {
		questions[questionIndex]?.possibleAnswers.splice(answerIndex, 1);
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = ``;
		const rawMax = String(maxGuests).trim();
		const parsedMax = rawMax === `` ? null : Number(rawMax);
		if (parsedMax != null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
			errorMessage = `Die Gästezahl muss mindestens 1 sein.`;
			return;
		}
		const result = await saveEventRegistrationSettings({
			eventId,
			hostSecret,
			registrationEnabled,
			guestListVisibility,
			maxGuests: parsedMax,
			waitlistAutoMoveUp,
			questions: questions.map((question) => ({
				id: question.id,
				text: question.text,
				description: question.description,
				mandatory: question.mandatory,
				multipleAnswers: question.multipleAnswers,
				possibleAnswers: question.possibleAnswers,
			})),
		});
		if (!result.ok) {
			errorMessage = result.message;
			return;
		}
		registrationEnabled = result.view.registrationEnabled;
		guestListVisibility = result.view.guestListVisibility;
		maxGuests = result.view.maxGuests == null ? `` : String(result.view.maxGuests);
		waitlistAutoMoveUp = result.view.waitlistAutoMoveUp;
		questions = result.view.questions.map(toDraft);
		onSaved();
	}

	type QuestionDraft = {
		clientKey: string;
		id: number | null;
		text: string;
		description: string;
		mandatory: boolean;
		multipleAnswers: boolean;
		possibleAnswers: string[];
	};
</script>

<form class="bg-base-200 rounded-box flex flex-col gap-4 p-4" data-testid="registration-host" onsubmit={save}>
	<h2 class="text-lg font-semibold">Anmeldung</h2>
	<label class="flex items-center gap-3">
		<input type="checkbox" class="toggle" data-testid="registration-enabled-toggle" bind:checked={registrationEnabled} />
		<span>Gäste können sich anmelden</span>
	</label>

	<fieldset class="fieldset">
		<legend class="fieldset-legend">Wer sieht die Namen der Gäste?</legend>
		<select class="select w-full" data-testid="guest-list-visibility" bind:value={guestListVisibility}>
			{#each GUEST_LIST_VISIBILITIES as visibility (visibility)}
				<option value={visibility}>{GUEST_LIST_VISIBILITY_LABELS[visibility]}</option>
			{/each}
		</select>
	</fieldset>

	<fieldset class="fieldset">
		<legend class="fieldset-legend">Maximale Anzahl Gäste</legend>
		<input class="input w-full" type="number" min="1" placeholder="Unbegrenzt" data-testid="max-guests-input" bind:value={maxGuests} />
		<p class="label">Leer lassen, wenn es keine Grenze gibt. Ist der Event voll, kommen weitere Gäste auf die Warteliste.</p>
	</fieldset>

	<label class="flex items-center gap-3">
		<input type="checkbox" class="checkbox" data-testid="waitlist-auto-move" bind:checked={waitlistAutoMoveUp} />
		<span>Warteliste rückt automatisch nach, wenn jemand absagt</span>
	</label>

	<div class="flex flex-col gap-4">
		<h3 class="font-semibold">Fragen an Gäste</h3>
		<p class="text-base-content/70 text-sm">Die Antworten siehst du in der Liste unten. Vorgegebene Antworten sind optional.</p>
		{#each questions as question, index (question.clientKey)}
			<div class="bg-base-100 rounded-box flex flex-col gap-3 p-3">
				<div class="flex flex-wrap gap-2">
					<button type="button" class="btn btn-sm" data-testid={`question-up-${index}`} onclick={() => moveQuestion(index, -1)}>Hoch</button
					>
					<button type="button" class="btn btn-sm" data-testid={`question-down-${index}`} onclick={() => moveQuestion(index, 1)}
						>Runter</button
					>
					<button type="button" class="btn btn-sm" data-testid={`question-remove-${index}`} onclick={() => removeQuestion(index)}
						>Entfernen</button
					>
				</div>
				<label class="floating-label">
					<span>Frage</span>
					<input class="input w-full" data-testid={`question-text-${index}`} bind:value={question.text} />
				</label>
				<label class="floating-label">
					<span>Erklärung</span>
					<input class="input w-full" data-testid={`question-description-${index}`} bind:value={question.description} />
				</label>
				<label class="flex items-center gap-3">
					<input type="checkbox" class="checkbox" data-testid={`question-mandatory-${index}`} bind:checked={question.mandatory} />
					<span>Muss beantwortet werden</span>
				</label>
				<label class="flex items-center gap-3">
					<input type="checkbox" class="checkbox" data-testid={`question-multiple-${index}`} bind:checked={question.multipleAnswers} />
					<span>Mehrere Antworten auswählbar</span>
				</label>
				<div class="flex flex-col gap-2">
					<span class="text-sm font-medium">Vorgegebene Antworten</span>
					{#each question.possibleAnswers as answer, answerIndex (`${question.clientKey}-${answerIndex}`)}
						<div class="flex gap-2">
							<input
								class="input w-full"
								data-testid={`question-answer-${index}-${answerIndex}`}
								value={answer}
								oninput={(event) => {
									question.possibleAnswers[answerIndex] = event.currentTarget.value;
								}}
							/>
							<button type="button" class="btn btn-sm" onclick={() => removeAnswer(index, answerIndex)}>Entfernen</button>
						</div>
					{/each}
					<button type="button" class="btn btn-sm w-fit" data-testid={`question-answer-add-${index}`} onclick={() => addAnswer(index)}>
						Antwort hinzufügen
					</button>
				</div>
			</div>
		{/each}
		<button type="button" class="btn w-fit" data-testid="question-add" onclick={addQuestion}>Frage hinzufügen</button>
	</div>

	{#if errorMessage}
		<p class="text-error text-sm" data-testid="registration-settings-error">{errorMessage}</p>
	{/if}
	<button
		class="btn btn-primary w-fit"
		type="submit"
		data-testid="registration-settings-save"
		disabled={saveEventRegistrationSettings.pending > 0}
	>
		{saveEventRegistrationSettings.pending > 0 ? `Speichert…` : `Anmeldung speichern`}
	</button>

	<div class="flex flex-col gap-2" data-testid="host-registrations">
		<h3 class="font-semibold">Anmeldungen</h3>
		{#if view.hostRegistrations?.length}
			<ul class="flex flex-col gap-3">
				{#each view.hostRegistrations as registration (registration.id)}
					<li class="bg-base-100 rounded-box p-3" data-testid="host-registration-row">
						<p>
							<span data-testid="host-registration-name">{registration.name}</span>
							<span class="text-base-content/70"> · </span>
							<span data-testid="host-registration-email">{registration.email}</span>
							<span class="text-base-content/70"> · </span>
							<span data-testid="host-registration-status">{statusLabel[registration.status]}</span>
						</p>
						{#if registration.comment}
							<p class="text-sm">{registration.comment}</p>
						{/if}
						{#each registration.answers as answer (`${registration.id}-${answer.questionId}`)}
							<p class="text-sm" data-testid="host-registration-answer">
								{answer.question}: {formatRegistrationAnswer(answer.answer)}
							</p>
						{/each}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-base-content/70 text-sm">Noch keine Anmeldungen.</p>
		{/if}
	</div>
</form>
