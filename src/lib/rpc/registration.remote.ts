import { command, getRequestEvent, query } from "$app/server";
import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { assertUserIsAllowedToEditEvent } from "$lib/events.remote.shared";
import { GUEST_LIST_VISIBILITIES } from "$lib/registration";
import { ensureUserId } from "$lib/server/common";
import { sendRegistrationEmail } from "$lib/server/email";
import { cancelRegistration, loadRegistrationView, registerForEvent, saveRegistrationSettings } from "$lib/server/registration";

const questionSchema = v.object({
	id: v.optional(v.nullable(v.number()), null),
	text: v.string(),
	description: v.optional(v.string(), ``),
	mandatory: v.boolean(),
	possibleAnswers: v.array(v.string()),
	multipleAnswers: v.boolean(),
});

const settingsSchema = v.object({
	eventId: v.number(),
	hostSecret: v.optional(v.string(), ``),
	registrationEnabled: v.boolean(),
	guestListVisibility: v.picklist(GUEST_LIST_VISIBILITIES),
	maxGuests: v.nullable(v.number()),
	waitlistAutoMoveUp: v.boolean(),
	questions: v.array(questionSchema),
});

const registerSchema = v.object({
	eventId: v.number(),
	name: v.string(),
	email: v.string(),
	comment: v.optional(v.string(), ``),
	answers: v.array(
		v.object({
			questionId: v.number(),
			answer: v.union([v.string(), v.array(v.string())]),
		}),
	),
});

export const getEventRegistration = query(
	v.object({
		eventId: v.number(),
		hostSecret: v.optional(v.string(), ``),
	}),
	async ({ eventId, hostSecret }) => {
		const { userId, jwtClaims, isAdminSession } = getRequestEvent().locals;
		const view = await loadRegistrationView({
			eventId,
			viewerUserId: userId ?? null,
			viewerEmail: jwtClaims?.email ?? null,
			viewerName: jwtClaims?.user_metadata?.display_name ?? null,
			hostSecret,
			isAdmin: isAdminSession,
		});
		if (!view) error(404, `Event nicht gefunden`);
		return view;
	},
);

export const saveEventRegistrationSettings = command(settingsSchema, async (data) => {
	await assertUserIsAllowedToEditEvent(data.eventId, data.hostSecret);
	const saved = await saveRegistrationSettings({
		eventId: data.eventId,
		registrationEnabled: data.registrationEnabled,
		guestListVisibility: data.guestListVisibility,
		maxGuests: data.maxGuests,
		waitlistAutoMoveUp: data.waitlistAutoMoveUp,
		questions: data.questions,
	});
	if (!saved.ok) return saved;
	const view = await currentView({ eventId: data.eventId, hostSecret: data.hostSecret });
	return { ok: true as const, view };
});

export const submitEventRegistration = command(registerSchema, async (data) => {
	const userId = ensureUserId({ msg: `Bitte melde dich an.` });
	const result = await registerForEvent({
		eventId: data.eventId,
		userId,
		name: data.name,
		email: data.email,
		comment: data.comment,
		answers: data.answers,
	});
	if (!result.ok) return result;
	await notifyGuest({
		to: result.email,
		eventName: result.eventName,
		eventSlug: result.eventSlug,
		kind: result.status === `waitlist` ? `waitlist` : `registered`,
	});
	return { ok: true as const, status: result.status };
});

export const cancelEventRegistration = command(v.object({ eventId: v.number() }), async ({ eventId }) => {
	const userId = ensureUserId({ msg: `Bitte melde dich an.` });
	const result = await cancelRegistration({ eventId, userId });
	if (!result.ok) return result;
	await notifyGuest({ to: result.email, eventName: result.eventName, eventSlug: result.eventSlug, kind: `cancelled` });
	if (result.promotedEmail) {
		await notifyGuest({
			to: result.promotedEmail,
			eventName: result.eventName,
			eventSlug: result.eventSlug,
			kind: `promoted`,
		});
	}
	return { ok: true as const, status: result.status };
});

async function currentView(args: { eventId: number; hostSecret: string }) {
	const { userId, jwtClaims, isAdminSession } = getRequestEvent().locals;
	const view = await loadRegistrationView({
		eventId: args.eventId,
		viewerUserId: userId ?? null,
		viewerEmail: jwtClaims?.email ?? null,
		viewerName: jwtClaims?.user_metadata?.display_name ?? null,
		hostSecret: args.hostSecret,
		isAdmin: isAdminSession,
	});
	if (!view) error(404, `Event nicht gefunden`);
	return view;
}

async function notifyGuest(args: {
	to: string;
	eventName: string;
	eventSlug: string;
	kind: `registered` | `waitlist` | `promoted` | `cancelled`;
}) {
	try {
		await sendRegistrationEmail(args);
	} catch (err) {
		console.error(`registration email failed`, err);
	}
}
