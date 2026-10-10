import { error, json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { listPrimaryTelegramGroupDialogs } from '$lib/server/telegramClient';

export const config: Config = {
	// teleproto is heavy — keep it out of the shared remotes/catchall function
	split: true,
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.isAdminSession) {
		error(403, `Admin only`);
	}

	try {
		const dialogs = await listPrimaryTelegramGroupDialogs();
		return json({
			dialogs: dialogs.map((dialog) => ({
				...dialog,
				lastMessageTime: dialog.lastMessageTime?.toISOString() ?? null,
			})),
		});
	} catch (err) {
		const message =
			err instanceof Error ? err.message : `Telegram-Dialoge konnten nicht geladen werden`;
		error(400, message);
	}
};
