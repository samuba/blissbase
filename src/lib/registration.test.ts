import { describe, expect, it } from "vitest";
import {
	buildRegistrationView,
	canSeeGuestCount,
	canSeeGuestNames,
	commentVisibilityLabel,
	nextRegistrationStatus,
	normalizeQuestions,
	validateRegistrationSubmission,
	waitlistPromotionId,
	type RegistrationQuestionView,
	type StoredRegistration,
} from "./registration";

const choice = question({
	id: 1,
	text: `Sith oder Jedi?`,
	mandatory: true,
	possibleAnswers: [`Jedi`, `Sith`],
	multipleAnswers: false,
	sortOrder: 0,
});
const multi = question({
	id: 2,
	text: `Workshops`,
	mandatory: false,
	possibleAnswers: [`Yoga`, `Dance`],
	multipleAnswers: true,
	sortOrder: 1,
});
const free = question({
	id: 3,
	text: `Planet`,
	description: null,
	mandatory: false,
	possibleAnswers: [],
	multipleAnswers: false,
	sortOrder: 2,
});

describe(`nextRegistrationStatus`, () => {
	it(`registers when there is no limit`, () => {
		expect(nextRegistrationStatus({ maxGuests: null, registeredCount: 40, currentStatus: null })).toBe(`registered`);
	});

	it(`waitlists a new guest when the registered seats are full`, () => {
		expect(nextRegistrationStatus({ maxGuests: 2, registeredCount: 2, currentStatus: null })).toBe(`waitlist`);
		expect(nextRegistrationStatus({ maxGuests: 2, registeredCount: 1, currentStatus: `cancelled` })).toBe(`registered`);
	});

	it(`keeps an existing registered or waitlisted guest on that status`, () => {
		expect(nextRegistrationStatus({ maxGuests: 1, registeredCount: 1, currentStatus: `registered` })).toBe(`registered`);
		expect(nextRegistrationStatus({ maxGuests: 1, registeredCount: 0, currentStatus: `waitlist` })).toBe(`waitlist`);
	});
});

describe(`waitlistPromotionId`, () => {
	it(`promotes the oldest waitlist id after a registered guest cancels`, () => {
		expect(
			waitlistPromotionId({
				cancelledStatus: `registered`,
				waitlistAutoMoveUp: true,
				waitlistIdsInOrder: [8, 3],
			}),
		).toBe(8);
	});

	it(`promotes nobody when auto-move is off, the list is empty, or a waitlist row was cancelled`, () => {
		expect(waitlistPromotionId({ cancelledStatus: `registered`, waitlistAutoMoveUp: false, waitlistIdsInOrder: [1] })).toBeNull();
		expect(waitlistPromotionId({ cancelledStatus: `registered`, waitlistAutoMoveUp: true, waitlistIdsInOrder: [] })).toBeNull();
		expect(waitlistPromotionId({ cancelledStatus: `waitlist`, waitlistAutoMoveUp: true, waitlistIdsInOrder: [1] })).toBeNull();
	});
});

describe(`guest list visibility`, () => {
	const matrix = [
		{ visibility: `public` as const, guest: false, names: true, count: true },
		{ visibility: `guests` as const, guest: false, names: false, count: false },
		{ visibility: `guests` as const, guest: true, names: true, count: true },
		{ visibility: `guests_count_public` as const, guest: false, names: false, count: true },
		{ visibility: `guests_count_public` as const, guest: true, names: true, count: true },
		{ visibility: `owners` as const, guest: true, names: false, count: false },
		{ visibility: `owners_count_public` as const, guest: true, names: false, count: true },
	];

	it.each(matrix)(`$visibility guest=$guest`, ({ visibility, guest, names, count }) => {
		const args = { visibility, isHost: false, isRegisteredGuest: guest };
		expect(canSeeGuestNames(args)).toBe(names);
		expect(canSeeGuestCount(args)).toBe(count);
	});

	it(`lets the host see names and the count for every setting`, () => {
		for (const visibility of [`public`, `guests`, `owners`, `guests_count_public`, `owners_count_public`] as const) {
			const args = { visibility, isHost: true, isRegisteredGuest: false };
			expect(canSeeGuestNames(args)).toBe(true);
			expect(canSeeGuestCount(args)).toBe(true);
		}
	});

	it(`labels the comment hint from the same groups`, () => {
		expect(commentVisibilityLabel(`public`)).toBe(`optional, für alle sichtbar`);
		expect(commentVisibilityLabel(`guests`)).toBe(`optional, für andere Gäste sichtbar`);
		expect(commentVisibilityLabel(`guests_count_public`)).toBe(`optional, für andere Gäste sichtbar`);
		expect(commentVisibilityLabel(`owners`)).toBe(`optional, für Veranstalter sichtbar`);
		expect(commentVisibilityLabel(`owners_count_public`)).toBe(`optional, für Veranstalter sichtbar`);
	});
});

describe(`normalizeQuestions`, () => {
	it(`trims, drops blank choices, and numbers the order`, () => {
		const result = normalizeQuestions([
			{
				text: ` Schlafplatz? `,
				description: `  Damit wir planen können  `,
				mandatory: true,
				possibleAnswers: [` Ja `, ``, `Nein`],
				multipleAnswers: false,
			},
			{
				text: `Mitbringen`,
				description: ` `,
				mandatory: false,
				possibleAnswers: [],
				multipleAnswers: true,
			},
		]);
		expect(result).toEqual({
			ok: true,
			value: [
				{
					id: null,
					text: `Schlafplatz?`,
					description: `Damit wir planen können`,
					mandatory: true,
					possibleAnswers: [`Ja`, `Nein`],
					multipleAnswers: false,
					sortOrder: 0,
				},
				{
					id: null,
					text: `Mitbringen`,
					description: null,
					mandatory: false,
					possibleAnswers: [],
					multipleAnswers: false,
					sortOrder: 1,
				},
			],
		});
	});

	it(`rejects an empty question and duplicate choices`, () => {
		expect(normalizeQuestions([{ text: `  `, mandatory: false, possibleAnswers: [], multipleAnswers: false }])).toMatchObject({
			ok: false,
		});
		expect(normalizeQuestions([{ text: `Farbe`, mandatory: false, possibleAnswers: [`Rot`, `Rot`], multipleAnswers: true }])).toMatchObject(
			{ ok: false, message: `Vorgegebene Antworten müssen eindeutig sein.` },
		);
	});
});

describe(`validateRegistrationSubmission`, () => {
	const questions = [choice, multi, free];

	it(`stores a trimmed name, lowercased email, and typed answers`, () => {
		const result = validateRegistrationSubmission({
			name: `  Ada Lovelace `,
			email: `Ada@Example.com`,
			comment: ` komme später `,
			questions,
			answers: [
				{ questionId: 1, answer: `Jedi` },
				{ questionId: 2, answer: [`Yoga`, `Dance`] },
				{ questionId: 3, answer: `Erde` },
			],
		});
		expect(result).toEqual({
			ok: true,
			value: {
				name: `Ada Lovelace`,
				email: `ada@example.com`,
				comment: `komme später`,
				answers: [
					{ questionId: 1, answer: `Jedi` },
					{ questionId: 2, answer: [`Yoga`, `Dance`] },
					{ questionId: 3, answer: `Erde` },
				],
			},
		});
	});

	it(`requires the name, a real email, and mandatory answers`, () => {
		const result = validateRegistrationSubmission({
			name: `   `,
			email: `not-an-email`,
			comment: ``,
			questions,
			answers: [],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => issue.field)).toEqual([`name`, `email`, `question:1`]);
	});

	it(`rejects choices outside the list and arrays on a single-answer question`, () => {
		const outside = validateRegistrationSubmission({
			name: `Ada`,
			email: `ada@example.com`,
			comment: ``,
			questions,
			answers: [
				{ questionId: 1, answer: `Gray` },
				{ questionId: 2, answer: [`Nope`] },
			],
		});
		expect(outside.ok).toBe(false);
		const wrongShape = validateRegistrationSubmission({
			name: `Ada`,
			email: `ada@example.com`,
			comment: ``,
			questions,
			answers: [{ questionId: 1, answer: [`Jedi`] }],
		});
		expect(wrongShape.ok).toBe(false);
	});

	it(`omits optional empty answers and rejects an unknown question`, () => {
		const empty = validateRegistrationSubmission({
			name: `Ada`,
			email: `ada@example.com`,
			comment: `   `,
			questions,
			answers: [{ questionId: 1, answer: `Sith` }],
		});
		expect(empty).toMatchObject({ ok: true, value: { comment: null, answers: [{ questionId: 1, answer: `Sith` }] } });

		const unknown = validateRegistrationSubmission({
			name: `Ada`,
			email: `ada@example.com`,
			comment: ``,
			questions,
			answers: [
				{ questionId: 1, answer: `Sith` },
				{ questionId: 99, answer: `x` },
			],
		});
		expect(unknown.ok).toBe(false);
	});

	it(`rejects a name over 40 characters and a comment over 200`, () => {
		const result = validateRegistrationSubmission({
			name: `a`.repeat(41),
			email: `ada@example.com`,
			comment: `b`.repeat(201),
			questions: [],
			answers: [],
		});
		expect(result.ok).toBe(false);
	});
});

describe(`buildRegistrationView`, () => {
	const ada = registration({
		id: 1,
		userId: `ada`,
		name: `Ada`,
		email: `ada@secret.test`,
		status: `registered`,
		answers: [{ questionId: 1, answer: `Jedi` }],
		createdAt: new Date(`2026-01-01T00:00:00Z`),
	});
	const grace = registration({
		id: 2,
		userId: `grace`,
		name: `Grace`,
		email: `grace@secret.test`,
		status: `waitlist`,
		comment: `früher da`,
		createdAt: new Date(`2026-01-02T00:00:00Z`),
	});

	it(`shows names to everyone and hides other people's emails when visibility is public`, () => {
		const view = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `public` }),
			questions: [choice],
			registrations: [grace, ada],
			viewerUserId: `ada`,
			viewerEmail: `ada@secret.test`,
			viewerName: `Ada Lovelace`,
			hostSecret: null,
			isAdmin: false,
		});
		expect(view.showNames).toBe(true);
		expect(view.guests?.map((guest) => guest.name)).toEqual([`Ada`, `Grace`]);
		expect(view.registeredCount).toBe(1);
		expect(view.waitlistCount).toBe(1);
		expect(view.hostRegistrations).toBeNull();
		expect(JSON.stringify(view.guests)).not.toContain(`secret.test`);
		expect(view.mine?.answers).toEqual([{ questionId: 1, answer: `Jedi` }]);
	});

	it(`hides names and counts from a stranger when only guests may look`, () => {
		const view = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `guests` }),
			questions: [choice],
			registrations: [ada],
			viewerUserId: null,
			viewerEmail: null,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(view.showNames).toBe(false);
		expect(view.showCount).toBe(false);
		expect(view.guests).toBeNull();
		expect(view.registeredCount).toBeNull();
		expect(view.questions[0]?.possibleAnswers).toEqual([`Jedi`, `Sith`]);
		expect(JSON.stringify(view)).not.toContain(`ada@secret.test`);
		expect(view.hostRegistrations).toBeNull();
	});

	it(`shows the count but not the names for guests_count_public until the viewer is registered`, () => {
		const stranger = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `guests_count_public` }),
			questions: [],
			registrations: [ada, grace],
			viewerUserId: `grace`,
			viewerEmail: `grace@secret.test`,
			viewerName: `Grace`,
			hostSecret: null,
			isAdmin: false,
		});
		expect(stranger.showCount).toBe(true);
		expect(stranger.showNames).toBe(false);
		expect(stranger.registeredCount).toBe(1);
		expect(stranger.guests).toBeNull();
		expect(stranger.waitlistCount).toBeNull();

		const registered = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `guests_count_public` }),
			questions: [],
			registrations: [ada],
			viewerUserId: `ada`,
			viewerEmail: `ada@secret.test`,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(registered.showNames).toBe(true);
		expect(registered.guests?.[0]?.name).toBe(`Ada`);
	});

	it(`shows only the count for owners_count_public and nothing for owners`, () => {
		const countOnly = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `owners_count_public` }),
			questions: [],
			registrations: [ada],
			viewerUserId: null,
			viewerEmail: null,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(countOnly.showCount).toBe(true);
		expect(countOnly.showNames).toBe(false);
		expect(countOnly.registeredCount).toBe(1);

		const hidden = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `owners` }),
			questions: [choice],
			registrations: [ada],
			viewerUserId: `ada`,
			viewerEmail: `ada@secret.test`,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(hidden.showCount).toBe(false);
		expect(hidden.showNames).toBe(false);
		expect(hidden.questions).toEqual([choice]);
	});

	it(`gives the author, the host secret, and an admin the full registration table`, () => {
		const author = buildRegistrationView({
			event: eventSettings({ guestListVisibility: `owners`, authorId: `host` }),
			questions: [choice],
			registrations: [ada],
			viewerUserId: `host`,
			viewerEmail: `host@example.com`,
			viewerName: `Host`,
			hostSecret: null,
			isAdmin: false,
		});
		expect(author.isHost).toBe(true);
		expect(author.hostRegistrations?.[0]).toMatchObject({
			email: `ada@secret.test`,
			answers: [{ question: `Sith oder Jedi?`, answer: `Jedi` }],
		});

		const withSecret = buildRegistrationView({
			event: eventSettings({ hostSecret: `secret` }),
			questions: [],
			registrations: [],
			viewerUserId: `other`,
			viewerEmail: null,
			viewerName: null,
			hostSecret: `secret`,
			isAdmin: false,
		});
		expect(withSecret.isHost).toBe(true);

		const wrongSecret = buildRegistrationView({
			event: eventSettings({ hostSecret: `secret` }),
			questions: [],
			registrations: [],
			viewerUserId: `other`,
			viewerEmail: null,
			viewerName: null,
			hostSecret: ``,
			isAdmin: false,
		});
		expect(wrongSecret.isHost).toBe(false);
	});

	it(`hides questions and the list when registration is off, except from the host`, () => {
		const guest = buildRegistrationView({
			event: eventSettings({ registrationEnabled: false }),
			questions: [choice],
			registrations: [ada],
			viewerUserId: `ada`,
			viewerEmail: `ada@secret.test`,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(guest.registrationEnabled).toBe(false);
		expect(guest.questions).toEqual([]);
		expect(guest.showNames).toBe(false);
		expect(guest.mine?.name).toBe(`Ada`);
	});
});

function question(overrides: Partial<RegistrationQuestionView> & Pick<RegistrationQuestionView, `id` | `text`>): RegistrationQuestionView {
	return {
		description: null,
		mandatory: false,
		possibleAnswers: [],
		multipleAnswers: false,
		sortOrder: 0,
		...overrides,
	};
}

function eventSettings(overrides: Partial<Parameters<typeof buildRegistrationView>[0][`event`]> = {}) {
	return {
		registrationEnabled: true,
		guestListVisibility: `public` as const,
		maxGuests: null,
		waitlistAutoMoveUp: true,
		authorId: `host`,
		hostSecret: `secret`,
		...overrides,
	};
}

function registration(
	overrides: Partial<StoredRegistration> & Pick<StoredRegistration, `id` | `userId` | `name` | `email` | `status`>,
): StoredRegistration {
	return {
		comment: null,
		createdAt: new Date(`2026-01-01T00:00:00Z`),
		answers: [],
		...overrides,
	};
}
