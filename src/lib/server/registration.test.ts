import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, s } from "./db";
import { cancelRegistration, loadRegistrationView, registerForEvent, saveRegistrationSettings } from "./registration";

const hostId = `00000000-0000-4000-8000-0000000000a1`;
const adaId = `00000000-0000-4000-8000-0000000000a2`;
const graceId = `00000000-0000-4000-8000-0000000000a3`;

describe(`registration database`, () => {
	let eventId = 0;

	beforeEach(async () => {
		await db.delete(s.events).where(eq(s.events.source, `registration-test`));
		await db.delete(s.profiles).where(eq(s.profiles.id, hostId));
		await db.delete(s.profiles).where(eq(s.profiles.id, adaId));
		await db.delete(s.profiles).where(eq(s.profiles.id, graceId));
		await db.insert(s.profiles).values([
			{ id: hostId, displayName: `Host`, slug: `reg-host` },
			{ id: adaId, displayName: `Ada`, slug: `reg-ada` },
			{ id: graceId, displayName: `Grace`, slug: `reg-grace` },
		]);
		const [event] = await db
			.insert(s.events)
			.values({
				name: `Registration Circle`,
				startAt: new Date(`2026-12-01T18:00:00Z`),
				address: [`Berlin`],
				imageUrls: [],
				source: `registration-test`,
				slug: `registration-circle-test`,
				authorId: hostId,
				hostSecret: `secret`,
			})
			.returning({ id: s.events.id });
		eventId = event?.id ?? 0;
	});

	it(`saves questions, waitlists the second guest, and promotes them when the seat frees`, async () => {
		const saved = await saveRegistrationSettings({
			eventId,
			registrationEnabled: true,
			guestListVisibility: `guests`,
			maxGuests: 1,
			waitlistAutoMoveUp: true,
			questions: [
				{
					text: `Sith oder Jedi?`,
					description: `Für die Sitzordnung`,
					mandatory: true,
					possibleAnswers: [`Jedi`, `Sith`],
					multipleAnswers: false,
				},
				{
					text: `Workshops`,
					mandatory: false,
					possibleAnswers: [`Yoga`, `Dance`],
					multipleAnswers: true,
				},
			],
		});
		expect(saved).toEqual({ ok: true });

		const ada = await registerForEvent({
			eventId,
			userId: adaId,
			name: `Ada Lovelace`,
			email: `ada@example.com`,
			comment: ``,
			answers: [{ questionId: 0, answer: `Jedi` }],
		});
		expect(ada.ok).toBe(false);

		const questions = await db.query.registrationQuestions.findMany({
			where: eq(s.registrationQuestions.eventId, eventId),
		});
		const choiceId = questions.find((question) => question.text === `Sith oder Jedi?`)?.id ?? 0;
		const workshopsId = questions.find((question) => question.text === `Workshops`)?.id ?? 0;

		const registered = await registerForEvent({
			eventId,
			userId: adaId,
			name: `Ada Lovelace`,
			email: `ada@example.com`,
			comment: `später`,
			answers: [
				{ questionId: choiceId, answer: `Jedi` },
				{ questionId: workshopsId, answer: [`Yoga`] },
			],
		});
		expect(registered).toMatchObject({ ok: true, status: `registered` });

		const waiting = await registerForEvent({
			eventId,
			userId: graceId,
			name: `Grace Hopper`,
			email: `grace@example.com`,
			comment: ``,
			answers: [{ questionId: choiceId, answer: `Sith` }],
		});
		expect(waiting).toMatchObject({ ok: true, status: `waitlist` });

		const stranger = await loadRegistrationView({
			eventId,
			viewerUserId: null,
			viewerEmail: null,
			viewerName: null,
			hostSecret: null,
			isAdmin: false,
		});
		expect(stranger?.showNames).toBe(false);
		expect(stranger?.registeredCount).toBeNull();
		expect(JSON.stringify(stranger)).not.toContain(`ada@example.com`);

		const host = await loadRegistrationView({
			eventId,
			viewerUserId: hostId,
			viewerEmail: `host@example.com`,
			viewerName: `Host`,
			hostSecret: null,
			isAdmin: false,
		});
		expect(host?.hostRegistrations?.map((row) => `${row.name}:${row.status}`)).toEqual([
			`Ada Lovelace:registered`,
			`Grace Hopper:waitlist`,
		]);
		expect(host?.hostRegistrations?.[0]?.answers.map((answer) => answer.answer)).toEqual([`Jedi`, [`Yoga`]]);

		const cancelled = await cancelRegistration({ eventId, userId: adaId });
		expect(cancelled).toMatchObject({ ok: true, status: `cancelled`, promotedEmail: expect.any(String) });

		const after = await loadRegistrationView({
			eventId,
			viewerUserId: hostId,
			viewerEmail: null,
			viewerName: null,
			hostSecret: `secret`,
			isAdmin: false,
		});
		const statuses = Object.fromEntries((after?.hostRegistrations ?? []).map((row) => [row.name, row.status]));
		expect(statuses).toEqual({ "Ada Lovelace": `cancelled`, "Grace Hopper": `registered` });
		expect(after?.registeredCount).toBe(1);
		expect(after?.guests?.map((guest) => `${guest.name}:${guest.status}`)).toEqual([
			`Ada Lovelace:cancelled`,
			`Grace Hopper:registered`,
		]);

		const again = await cancelRegistration({ eventId, userId: adaId });
		expect(again).toMatchObject({ ok: false });
	});
});
