import { routes } from '$lib/routes';
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
	const eventUrl = routes.eventDetails(args.eventSlug, true);
	const text = `
Dein Event wurde erstellt:

${args.eventName}

${eventUrl}`.trim();

	return await sendEmail({from, to: [args.to], subject, text});
}

async function sendEmail(payload: SendEmailPayload) {
	try {
		const res = await fetch(`https://api.resend.com/emails`, {
			method: `POST`,
			headers: {
				Authorization: `Bearer ${RESEND_API_KEY}`,
				'Content-Type': `application/json`
			},
			body: JSON.stringify(payload)
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
