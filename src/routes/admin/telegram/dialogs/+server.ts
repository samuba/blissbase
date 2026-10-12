import { error, json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { listPrimaryTelegramGroupDialogs } from './listPrimary';

export const config: Config = {
	// teleproto is heavy — keep it out of the shared remotes/catchall function
	split: true,
	// Connecting scrape sessions + getDialogs regularly exceeds the default limit.
	maxDuration: 60,
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.isAdminSession) {
		error(403, `Admin only`);
	}

	try {
		const { accounts, dialogs, accountStatuses } = await listPrimaryTelegramGroupDialogs();
		return json({
			accounts,
			accountStatuses,
			dialogs: dialogs.map((dialog) => ({
				...dialog,
				lastMessageTime: dialog.lastMessageTime?.toISOString() ?? null,
			})),
		});
	} catch (err) {
		console.error(`Failed to list Telegram dialogs:`, err);
		const message =
			err instanceof Error ? err.message : `Telegram-Dialoge konnten nicht geladen werden`;
		// Always JSON so the remote's internal fetch (which may forward Accept: text/html) can read `message`.
		return json({ message }, { status: 400 });
	}
};
