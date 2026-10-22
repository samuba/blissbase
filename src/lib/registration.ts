export const GUEST_LIST_VISIBILITIES = [`public`, `guests`, `owners`, `guests_count_public`, `owners_count_public`] as const;

export const REGISTRATION_STATUSES = [`registered`, `waitlist`, `cancelled`] as const;

export const NAME_MAX_LENGTH = 40;
export const COMMENT_MAX_LENGTH = 200;
export const ANSWER_MAX_LENGTH = 3000;
export const QUESTION_TEXT_MAX_LENGTH = 200;
export const QUESTION_DESCRIPTION_MAX_LENGTH = 500;
export const PREDEFINED_ANSWER_MAX_LENGTH = 80;
export const MAX_QUESTIONS = 20;
export const MAX_PREDEFINED_ANSWERS = 30;

export const GUEST_LIST_VISIBILITY_LABELS: Record<GuestListVisibility, string> = {
	public: `Jeder`,
	guests: `Nur Gäste`,
	guests_count_public: `Nur Gäste, jeder sieht die Anzahl`,
	owners: `Nur Veranstalter`,
	owners_count_public: `Nur Veranstalter, jeder sieht die Anzahl`,
};

/**
 * Seat for a new signup or for someone whose previous row is cancelled.
 * Registered and waitlisted guests keep their status when they edit the form.
 *
 * @example
 * nextRegistrationStatus({ maxGuests: 1, registeredCount: 1, currentStatus: null }); // `waitlist`
 */
export function nextRegistrationStatus(args: {
	maxGuests: number | null;
	registeredCount: number;
	currentStatus: RegistrationStatus | null;
}): RegistrationStatus {
	if (args.currentStatus === `registered` || args.currentStatus === `waitlist`) return args.currentStatus;
	if (args.maxGuests == null) return `registered`;
	if (args.registeredCount >= args.maxGuests) return `waitlist`;
	return `registered`;
}

/**
 * Oldest waitlist id to promote after a registered guest cancels. Null when auto-move is off,
 * the cancelled row was not registered, or nobody is waiting.
 *
 * @example
 * waitlistPromotionId({ cancelledStatus: `registered`, waitlistAutoMoveUp: true, waitlistIdsInOrder: [4, 9] }); // 4
 */
export function waitlistPromotionId(args: {
	cancelledStatus: RegistrationStatus;
	waitlistAutoMoveUp: boolean;
	waitlistIdsInOrder: number[];
}): number | null {
	if (args.cancelledStatus !== `registered`) return null;
	if (!args.waitlistAutoMoveUp) return null;
	return args.waitlistIdsInOrder[0] ?? null;
}

/**
 * @example
 * canSeeGuestNames({ visibility: `guests`, isHost: false, isRegisteredGuest: true }); // true
 */
export function canSeeGuestNames(args: { visibility: GuestListVisibility; isHost: boolean; isRegisteredGuest: boolean }) {
	if (args.isHost) return true;
	if (args.visibility === `public`) return true;
	if (args.isRegisteredGuest && (args.visibility === `guests` || args.visibility === `guests_count_public`)) return true;
	return false;
}

/**
 * @example
 * canSeeGuestCount({ visibility: `owners_count_public`, isHost: false, isRegisteredGuest: false }); // true
 */
export function canSeeGuestCount(args: { visibility: GuestListVisibility; isHost: boolean; isRegisteredGuest: boolean }) {
	if (canSeeGuestNames(args)) return true;
	if (args.visibility === `guests_count_public` || args.visibility === `owners_count_public`) return true;
	return false;
}

/**
 * Hint under the optional comment field. Matches who can see guest names.
 *
 * @example
 * commentVisibilityLabel(`owners`); // `optional, für Veranstalter sichtbar`
 */
export function commentVisibilityLabel(visibility: GuestListVisibility) {
	if (visibility === `public`) return `optional, für alle sichtbar`;
	if (visibility === `guests` || visibility === `guests_count_public`) return `optional, für andere Gäste sichtbar`;
	return `optional, für Veranstalter sichtbar`;
}

export function formatRegistrationAnswer(answer: RegistrationAnswerValue) {
	if (Array.isArray(answer)) return answer.join(`, `);
	return answer;
}

/**
 * Host question list → stored rows. Order is the array order.
 *
 * @example
 * normalizeQuestions([{ text: ` Veggie? `, description: ``, mandatory: false, possibleAnswers: [`Ja`, ``], multipleAnswers: false }]);
 */
export function normalizeQuestions(questions: QuestionInput[]): QuestionNormalizeResult {
	if (questions.length > MAX_QUESTIONS) return { ok: false, message: `Höchstens ${MAX_QUESTIONS} Fragen.` };

	const value: NormalizedQuestion[] = [];
	for (const [index, question] of questions.entries()) {
		const text = question.text.trim();
		if (!text) return { ok: false, message: `Bitte formuliere die Frage.` };
		if (text.length > QUESTION_TEXT_MAX_LENGTH) return { ok: false, message: `Eine Frage ist zu lang.` };

		const description = question.description?.trim() ?? ``;
		if (description.length > QUESTION_DESCRIPTION_MAX_LENGTH) return { ok: false, message: `Eine Erklärung ist zu lang.` };

		const possibleAnswers: string[] = [];
		for (const raw of question.possibleAnswers) {
			const answer = raw.trim();
			if (!answer) continue;
			if (answer.length > PREDEFINED_ANSWER_MAX_LENGTH) return { ok: false, message: `Eine vorgegebene Antwort ist zu lang.` };
			if (possibleAnswers.includes(answer)) return { ok: false, message: `Vorgegebene Antworten müssen eindeutig sein.` };
			possibleAnswers.push(answer);
		}
		if (possibleAnswers.length > MAX_PREDEFINED_ANSWERS) {
			return { ok: false, message: `Höchstens ${MAX_PREDEFINED_ANSWERS} vorgegebene Antworten.` };
		}

		value.push({
			id: question.id ?? null,
			text,
			description: description || null,
			mandatory: question.mandatory,
			possibleAnswers,
			multipleAnswers: possibleAnswers.length > 0 && question.multipleAnswers,
			sortOrder: index,
		});
	}

	return { ok: true, value };
}

/**
 * Guest form → stored name, email, comment, and answers.
 *
 * @example
 * validateRegistrationSubmission({ name: `Ada Lovelace`, email: `ada@example.com`, comment: ``, questions: [], answers: [] });
 */
export function validateRegistrationSubmission(args: {
	name: string;
	email: string;
	comment: string;
	questions: RegistrationQuestionView[];
	answers: { questionId: number; answer: RegistrationAnswerValue }[];
}): SubmissionResult {
	const issues: RegistrationIssue[] = [];
	const name = args.name.trim();
	if (!name) issues.push({ field: `name`, message: `Bitte gib deinen Namen an.` });
	if (name.length > NAME_MAX_LENGTH)
		issues.push({ field: `name`, message: `Der Name darf höchstens ${NAME_MAX_LENGTH} Zeichen lang sein.` });

	const email = args.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		issues.push({ field: `email`, message: `Bitte gib eine gültige E-Mail-Adresse an.` });
	}

	const comment = args.comment.trim();
	if (comment.length > COMMENT_MAX_LENGTH) {
		issues.push({ field: `comment`, message: `Der Kommentar darf höchstens ${COMMENT_MAX_LENGTH} Zeichen lang sein.` });
	}

	const knownIds = new Set(args.questions.map((question) => question.id));
	const seenAnswerIds = new Set<number>();
	for (const answer of args.answers) {
		if (!knownIds.has(answer.questionId)) {
			issues.push({ field: `answers`, message: `Unbekannte Frage.` });
			continue;
		}
		if (seenAnswerIds.has(answer.questionId)) {
			issues.push({ field: `question:${answer.questionId}`, message: `Jede Frage kann nur einmal beantwortet werden.` });
		}
		seenAnswerIds.add(answer.questionId);
	}

	const storedAnswers: { questionId: number; answer: RegistrationAnswerValue }[] = [];
	for (const question of [...args.questions].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const submitted = args.answers.find((answer) => answer.questionId === question.id);
		const checked = checkAnswer({ question, answer: submitted?.answer });
		if (!checked.ok) {
			issues.push({ field: `question:${question.id}`, message: checked.message });
			continue;
		}
		if (checked.answer != null) storedAnswers.push({ questionId: question.id, answer: checked.answer });
	}

	if (issues.length) return { ok: false, issues };

	return {
		ok: true,
		value: {
			name,
			email,
			comment: comment || null,
			answers: storedAnswers,
		},
	};
}

/**
 * Shapes the event page payload. Emails and answers of other guests are only included for hosts.
 *
 * @example
 * buildRegistrationView({ event, questions: [], registrations: [], viewerUserId: null, viewerEmail: null, viewerName: null, hostSecret: null, isAdmin: false });
 */
export function buildRegistrationView(args: {
	event: {
		registrationEnabled: boolean;
		guestListVisibility: GuestListVisibility;
		maxGuests: number | null;
		waitlistAutoMoveUp: boolean;
		authorId: string | null;
		hostSecret: string | null;
	};
	questions: RegistrationQuestionView[];
	registrations: StoredRegistration[];
	viewerUserId: string | null;
	viewerEmail: string | null;
	viewerName: string | null;
	hostSecret: string | null;
	isAdmin: boolean;
}): RegistrationView {
	const questions = [...args.questions].sort((a, b) => a.sortOrder - b.sortOrder);
	const registrations = [...args.registrations].sort((a, b) => {
		const created = a.createdAt.getTime() - b.createdAt.getTime();
		if (created !== 0) return created;
		return a.id - b.id;
	});
	const secretMatches = Boolean(args.hostSecret && args.event.hostSecret && args.hostSecret === args.event.hostSecret);
	const isHost = Boolean(args.isAdmin || (args.viewerUserId && args.viewerUserId === args.event.authorId) || secretMatches);
	const mineRow = args.viewerUserId ? (registrations.find((row) => row.userId === args.viewerUserId) ?? null) : null;
	const isRegisteredGuest = mineRow?.status === `registered`;
	const visibilityArgs = { visibility: args.event.guestListVisibility, isHost, isRegisteredGuest };
	const showNames = args.event.registrationEnabled && canSeeGuestNames(visibilityArgs);
	const showCount = args.event.registrationEnabled && canSeeGuestCount(visibilityArgs);
	const questionText = new Map(questions.map((question) => [question.id, question.text]));

	const registeredCount = registrations.filter((row) => row.status === `registered`).length;
	const waitlistCount = registrations.filter((row) => row.status === `waitlist`).length;

	const guests = showNames
		? registrations
				.filter((row) => row.status === `registered` || row.status === `waitlist`)
				.map((row) => ({
					name: row.name,
					comment: row.comment,
					status: row.status as `registered` | `waitlist`,
				}))
		: null;

	return {
		registrationEnabled: args.event.registrationEnabled,
		guestListVisibility: args.event.guestListVisibility,
		maxGuests: args.event.maxGuests,
		waitlistAutoMoveUp: args.event.waitlistAutoMoveUp,
		questions: args.event.registrationEnabled || isHost ? questions : [],
		registeredCount: showCount ? registeredCount : null,
		waitlistCount: showCount && showNames ? waitlistCount : null,
		showCount,
		showNames,
		guests,
		mine: mineRow
			? {
					status: mineRow.status,
					name: mineRow.name,
					email: mineRow.email,
					comment: mineRow.comment,
					answers: mineRow.answers,
				}
			: null,
		suggestedName: args.viewerName?.trim() || ``,
		suggestedEmail: args.viewerEmail?.trim().toLowerCase() || ``,
		isHost,
		hostRegistrations: isHost
			? registrations.map((row) => ({
					id: row.id,
					name: row.name,
					email: row.email,
					comment: row.comment,
					status: row.status,
					answers: row.answers.map((answer) => ({
						questionId: answer.questionId,
						question: questionText.get(answer.questionId) ?? ``,
						answer: answer.answer,
					})),
				}))
			: null,
	};
}

function checkAnswer(args: {
	question: RegistrationQuestionView;
	answer: RegistrationAnswerValue | undefined;
}): { ok: true; answer: RegistrationAnswerValue | null } | { ok: false; message: string } {
	const { question } = args;
	if (question.possibleAnswers.length && question.multipleAnswers) {
		if (args.answer == null) {
			if (question.mandatory) return { ok: false, message: `Bitte wähle mindestens eine Antwort.` };
			return { ok: true, answer: null };
		}
		if (!Array.isArray(args.answer)) return { ok: false, message: `Bitte wähle aus den vorgegebenen Antworten.` };
		if (question.mandatory && !args.answer.length) return { ok: false, message: `Bitte wähle mindestens eine Antwort.` };
		const picked: string[] = [];
		for (const value of args.answer) {
			const trimmed = value.trim();
			if (!trimmed) continue;
			if (!question.possibleAnswers.includes(trimmed)) return { ok: false, message: `Bitte wähle aus den vorgegebenen Antworten.` };
			if (picked.includes(trimmed)) return { ok: false, message: `Jede Antwort kann nur einmal gewählt werden.` };
			picked.push(trimmed);
		}
		if (question.mandatory && !picked.length) return { ok: false, message: `Bitte wähle mindestens eine Antwort.` };
		if (!picked.length) return { ok: true, answer: null };
		return { ok: true, answer: picked };
	}

	if (args.answer != null && Array.isArray(args.answer)) {
		return { ok: false, message: `Bitte gib eine Antwort an.` };
	}
	const text = args.answer?.trim() ?? ``;
	if (!text) {
		if (question.mandatory) {
			return {
				ok: false,
				message: question.possibleAnswers.length ? `Bitte wähle eine Antwort.` : `Bitte beantworte diese Frage.`,
			};
		}
		return { ok: true, answer: null };
	}
	if (question.possibleAnswers.length && !question.possibleAnswers.includes(text)) {
		return { ok: false, message: `Bitte wähle eine der vorgegebenen Antworten.` };
	}
	if (text.length > ANSWER_MAX_LENGTH) return { ok: false, message: `Die Antwort ist zu lang.` };
	return { ok: true, answer: text };
}

export type GuestListVisibility = (typeof GUEST_LIST_VISIBILITIES)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type RegistrationAnswerValue = string | string[];

export type QuestionInput = {
	id?: number | null;
	text: string;
	description?: string | null;
	mandatory: boolean;
	possibleAnswers: string[];
	multipleAnswers: boolean;
};

export type NormalizedQuestion = {
	id: number | null;
	text: string;
	description: string | null;
	mandatory: boolean;
	possibleAnswers: string[];
	multipleAnswers: boolean;
	sortOrder: number;
};

export type QuestionNormalizeResult = { ok: true; value: NormalizedQuestion[] } | { ok: false; message: string };

export type RegistrationQuestionView = {
	id: number;
	text: string;
	description: string | null;
	mandatory: boolean;
	possibleAnswers: string[];
	multipleAnswers: boolean;
	sortOrder: number;
};

export type RegistrationIssue = { field: string; message: string };

export type SubmissionResult =
	| {
			ok: true;
			value: {
				name: string;
				email: string;
				comment: string | null;
				answers: { questionId: number; answer: RegistrationAnswerValue }[];
			};
	  }
	| { ok: false; issues: RegistrationIssue[] };

export type StoredRegistration = {
	id: number;
	userId: string;
	name: string;
	email: string;
	comment: string | null;
	status: RegistrationStatus;
	createdAt: Date;
	answers: { questionId: number; answer: RegistrationAnswerValue }[];
};

export type PublicGuest = {
	name: string;
	comment: string | null;
	status: `registered` | `waitlist`;
};

export type HostRegistration = {
	id: number;
	name: string;
	email: string;
	comment: string | null;
	status: RegistrationStatus;
	answers: { questionId: number; question: string; answer: RegistrationAnswerValue }[];
};

export type RegistrationView = {
	registrationEnabled: boolean;
	guestListVisibility: GuestListVisibility;
	maxGuests: number | null;
	waitlistAutoMoveUp: boolean;
	questions: RegistrationQuestionView[];
	registeredCount: number | null;
	waitlistCount: number | null;
	showCount: boolean;
	showNames: boolean;
	guests: PublicGuest[] | null;
	mine: {
		status: RegistrationStatus;
		name: string;
		email: string;
		comment: string | null;
		answers: { questionId: number; answer: RegistrationAnswerValue }[];
	} | null;
	suggestedName: string;
	suggestedEmail: string;
	isHost: boolean;
	hostRegistrations: HostRegistration[] | null;
};
