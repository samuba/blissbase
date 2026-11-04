import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, s } from "$lib/server/db";
import {
	buildRegistrationView,
	nextRegistrationStatus,
	normalizeQuestions,
	validateRegistrationSubmission,
	waitlistPromotionId,
	type GuestListVisibility,
	type QuestionInput,
	type RegistrationStatus,
	type RegistrationView,
} from "$lib/registration";

/**
 * Page payload for one event. Null when the event does not exist.
 *
 * @example
 * await loadRegistrationView({ eventId: 1, viewerUserId: null, viewerEmail: null, viewerName: null, hostSecret: null, isAdmin: false });
 */
export async function loadRegistrationView(args: {
	eventId: number;
	viewerUserId: string | null;
	viewerEmail: string | null;
	viewerName: string | null;
	hostSecret: string | null;
	isAdmin: boolean;
}): Promise<RegistrationView | null> {
	const event = await db.query.events.findFirst({
		where: eq(s.events.id, args.eventId),
		with: {
			registrationQuestions: true,
			registrations: { with: { answers: true } },
		},
	});
	if (!event) return null;

	const profile = args.viewerUserId
		? await db.query.profiles.findFirst({
				where: eq(s.profiles.id, args.viewerUserId),
				columns: { displayName: true },
			})
		: null;

	return buildRegistrationView({
		event,
		questions: event.registrationQuestions,
		registrations: event.registrations.map((row) => ({
			id: row.id,
			userId: row.userId,
			name: row.name,
			email: row.email,
			comment: row.comment,
			status: row.status,
			createdAt: row.createdAt,
			answers: row.answers.map((answer) => ({ questionId: answer.questionId, answer: answer.answer })),
		})),
		viewerUserId: args.viewerUserId,
		viewerEmail: args.viewerEmail,
		viewerName: args.viewerName ?? profile?.displayName ?? null,
		hostSecret: args.hostSecret,
		isAdmin: args.isAdmin,
	});
}

/**
 * Replaces the host's registration settings and questions. Existing question ids are updated in place.
 *
 * @example
 * await saveRegistrationSettings({ eventId: 1, registrationEnabled: true, guestListVisibility: `public`, maxGuests: null, waitlistAutoMoveUp: true, questions: [] });
 */
export async function saveRegistrationSettings(args: {
	eventId: number;
	registrationEnabled: boolean;
	guestListVisibility: GuestListVisibility;
	maxGuests: number | null;
	waitlistAutoMoveUp: boolean;
	questions: QuestionInput[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
	if (args.maxGuests != null && (!Number.isInteger(args.maxGuests) || args.maxGuests < 1)) {
		return { ok: false, message: `Die Gästezahl muss mindestens 1 sein.` };
	}
	const normalized = normalizeQuestions(args.questions);
	if (!normalized.ok) return normalized;

	const existing = await db.query.registrationQuestions.findMany({
		where: eq(s.registrationQuestions.eventId, args.eventId),
	});
	const existingIds = new Set(existing.map((question) => question.id));
	for (const question of normalized.value) {
		if (question.id != null && !existingIds.has(question.id)) return { ok: false, message: `Unbekannte Frage.` };
	}

	const keptIds = new Set<number>();
	await db.transaction(async (tx) => {
		await tx
			.update(s.events)
			.set({
				registrationEnabled: args.registrationEnabled,
				guestListVisibility: args.guestListVisibility,
				maxGuests: args.maxGuests,
				waitlistAutoMoveUp: args.waitlistAutoMoveUp,
				updatedAt: sql`now()`,
			})
			.where(eq(s.events.id, args.eventId));

		for (const question of normalized.value) {
			const values = {
				text: question.text,
				description: question.description,
				mandatory: question.mandatory,
				sortOrder: question.sortOrder,
				possibleAnswers: question.possibleAnswers,
				multipleAnswers: question.multipleAnswers,
			};
			if (question.id != null) {
				await tx.update(s.registrationQuestions).set(values).where(eq(s.registrationQuestions.id, question.id));
				keptIds.add(question.id);
				continue;
			}
			const [inserted] = await tx
				.insert(s.registrationQuestions)
				.values({ eventId: args.eventId, ...values })
				.returning({ id: s.registrationQuestions.id });
			if (inserted) keptIds.add(inserted.id);
		}

		const removedIds = existing.map((question) => question.id).filter((id) => !keptIds.has(id));
		if (removedIds.length) {
			await tx.delete(s.registrationQuestions).where(inArray(s.registrationQuestions.id, removedIds));
		}
	});

	return { ok: true };
}

/**
 * Creates or updates the signed-in guest's registration. A full event puts a new guest on the waitlist.
 *
 * @example
 * await registerForEvent({ eventId: 1, userId, name: `Ada`, email: `ada@example.com`, comment: ``, answers: [] });
 */
export async function registerForEvent(args: {
	eventId: number;
	userId: string;
	name: string;
	email: string;
	comment: string;
	answers: { questionId: number; answer: string | string[] }[];
}): Promise<
	{ ok: true; status: RegistrationStatus; email: string; eventName: string; eventSlug: string } | { ok: false; message: string }
> {
	const event = await db.query.events.findFirst({
		where: eq(s.events.id, args.eventId),
		with: { registrationQuestions: true },
	});
	if (!event) return { ok: false, message: `Event nicht gefunden.` };
	if (!event.registrationEnabled) return { ok: false, message: `Anmeldung ist für diesen Event nicht geöffnet.` };

	const validated = validateRegistrationSubmission({
		name: args.name,
		email: args.email,
		comment: args.comment,
		questions: event.registrationQuestions,
		answers: args.answers,
	});
	if (!validated.ok) return { ok: false, message: validated.issues[0]?.message ?? `Bitte prüfe deine Angaben.` };

	let status: RegistrationStatus = `registered`;
	await db.transaction(async (tx) => {
		await tx.execute(sql`select id from events where id = ${args.eventId} for update`);
		await tx.insert(s.profiles).values({ id: args.userId }).onConflictDoNothing();

		const registered = await tx.query.registrations.findMany({
			where: and(eq(s.registrations.eventId, args.eventId), eq(s.registrations.status, `registered`)),
			columns: { id: true },
		});
		const mine = await tx.query.registrations.findFirst({
			where: and(eq(s.registrations.eventId, args.eventId), eq(s.registrations.userId, args.userId)),
		});
		status = nextRegistrationStatus({
			maxGuests: event.maxGuests,
			registeredCount: registered.length,
			currentStatus: mine?.status ?? null,
		});
		const values = {
			name: validated.value.name,
			email: validated.value.email,
			comment: validated.value.comment,
			status,
			updatedAt: new Date(),
		};
		const registrationId = mine
			? mine.id
			: (
					await tx
						.insert(s.registrations)
						.values({ eventId: args.eventId, userId: args.userId, ...values })
						.returning({ id: s.registrations.id })
				)[0]?.id;
		if (!registrationId) return;
		if (mine) {
			await tx.update(s.registrations).set(values).where(eq(s.registrations.id, mine.id));
		}
		await tx.delete(s.registrationAnswers).where(eq(s.registrationAnswers.registrationId, registrationId));
		if (validated.value.answers.length) {
			await tx.insert(s.registrationAnswers).values(
				validated.value.answers.map((answer) => ({
					registrationId,
					questionId: answer.questionId,
					answer: answer.answer,
				})),
			);
		}
	});

	return {
		ok: true,
		status,
		email: validated.value.email,
		eventName: event.name,
		eventSlug: event.slug,
	};
}

/**
 * Marks the guest cancelled and, when they had a seat, promotes the oldest waitlist row.
 *
 * @example
 * await cancelRegistration({ eventId: 1, userId });
 */
export async function cancelRegistration(args: {
	eventId: number;
	userId: string;
}): Promise<
	| { ok: true; status: `cancelled`; email: string; eventName: string; eventSlug: string; promotedEmail: string | null }
	| { ok: false; message: string }
> {
	const event = await db.query.events.findFirst({
		where: eq(s.events.id, args.eventId),
		columns: { id: true, name: true, slug: true, waitlistAutoMoveUp: true },
	});
	if (!event) return { ok: false, message: `Event nicht gefunden.` };

	let cancelledEmail: string | null = null;
	let promotedEmail: string | null = null;
	let missing = false;

	await db.transaction(async (tx) => {
		await tx.execute(sql`select id from events where id = ${args.eventId} for update`);
		const mine = await tx.query.registrations.findFirst({
			where: and(eq(s.registrations.eventId, args.eventId), eq(s.registrations.userId, args.userId)),
		});
		if (!mine || mine.status === `cancelled`) {
			missing = true;
			return;
		}
		cancelledEmail = mine.email;
		await tx.update(s.registrations).set({ status: `cancelled`, updatedAt: new Date() }).where(eq(s.registrations.id, mine.id));

		const waiting = await tx.query.registrations.findMany({
			where: and(eq(s.registrations.eventId, args.eventId), eq(s.registrations.status, `waitlist`)),
			orderBy: [asc(s.registrations.createdAt), asc(s.registrations.id)],
			columns: { id: true, email: true },
		});
		const promoteId = waitlistPromotionId({
			cancelledStatus: mine.status,
			waitlistAutoMoveUp: event.waitlistAutoMoveUp,
			waitlistIdsInOrder: waiting.map((row) => row.id),
		});
		const nextGuest = waiting.find((row) => row.id === promoteId);
		if (!nextGuest) return;
		await tx.update(s.registrations).set({ status: `registered`, updatedAt: new Date() }).where(eq(s.registrations.id, nextGuest.id));
		promotedEmail = nextGuest.email;
	});

	if (missing || !cancelledEmail) return { ok: false, message: `Du bist nicht angemeldet.` };
	return {
		ok: true,
		status: `cancelled`,
		email: cancelledEmail,
		eventName: event.name,
		eventSlug: event.slug,
		promotedEmail,
	};
}
