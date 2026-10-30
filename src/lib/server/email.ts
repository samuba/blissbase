import { shouldSkipRecipient } from '$lib/common';
import { absoluteUrl, routes } from '$lib/routes';
import { posthogCaptureException } from './common';
import {RESEND_API_KEY} from '$env/static/private';

const from = `Blissbase <hi@blissbase.app>`;

/**
 * Sends a confirmation email after an event was created.
 *
 * @example
 * await sendEventCreatedEmail({
 *   to: `user@example.com`,
 *   eventName: `Breathwork Circle`,
 *   eventSlug: `2026-02-26-breathwork-circle`,
 *   startAt: new Date(),
 *   endAt: null,
 *   isOnline: true,
 *   addressLines: [],
 *   description: `Join us for an evening session`,
 *   price: `Donation based`
 * });
 */
export async function sendEventCreatedEmail(args: SendEventCreatedEmailArgs) {
	const subject = `Dein Event wurde erstellt`;
	const eventUrl = absoluteUrl(routes.eventDetails(args.eventSlug));
	const text = `
Dein Event wurde erstellt:

${args.eventName}

${eventUrl}`.trim();

	return await sendEmail({from, to: [args.to], subject, text});
}

/**
 * Tells a guest what happened to their registration. Failure is reported by `sendEmail` and does not throw.
 *
 * @example
 * await sendRegistrationEmail({ to: `ada@example.com`, eventName: `Kreis`, eventSlug: `kreis`, kind: `registered` });
 */
export async function sendRegistrationEmail(args: {
	to: string;
	eventName: string;
	eventSlug: string;
	kind: `registered` | `waitlist` | `promoted` | `cancelled`;
}) {
	const eventUrl = absoluteUrl(routes.eventDetails(args.eventSlug));
	const lead = {
		registered: `Du bist für ${args.eventName} angemeldet.`,
		waitlist: `Du stehst für ${args.eventName} auf der Warteliste. Wir schreiben dir, wenn ein Platz frei wird.`,
		promoted: `Es ist ein Platz frei geworden. Du bist jetzt für ${args.eventName} angemeldet.`,
		cancelled: `Deine Anmeldung für ${args.eventName} ist abgemeldet.`,
	}[args.kind];
	const subject = {
		registered: `Anmeldung: ${args.eventName}`,
		waitlist: `Warteliste: ${args.eventName}`,
		promoted: `Du bist nachgerückt: ${args.eventName}`,
		cancelled: `Abgemeldet: ${args.eventName}`,
	}[args.kind];

	return await sendEmail({
		from,
		to: [args.to],
		subject,
		text: `${lead}\n\n${eventUrl}`,
	});
}

async function sendEmail(payload: SendEmailPayload) {
	const to = payload.to.filter((address) => !shouldSkipRecipient(address));
	if (!to.length) return true;

	try {
		const res = await fetch(`https://api.resend.com/emails`, {
			method: `POST`,
			headers: {
				Authorization: `Bearer ${RESEND_API_KEY}`,
				'Content-Type': `application/json`
			},
			body: JSON.stringify({ ...payload, to })
		});
		if (!res.ok) throw new Error(`Resend returned unexpected status: ${res.status} ${res.statusText} ${await res.text()}`);
		return true;
	} catch (error) {
		posthogCaptureException(new Error(`Failed to send email: ${error}`));
		return false;
	}
}

type SendEventCreatedEmailArgs = {
	to: string;
	eventName: string;
	eventSlug: string;
	startAt: Date;
	endAt: Date | null;
	isOnline: boolean;
};

type SendEmailPayload = {
	from: string;
	to: string[];
	subject: string;
	text: string;
};
