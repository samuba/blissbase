import { error, json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { resolveTelegramScrapingTarget } from '$lib/server/telegramClient';

export const config: Config = {
	// teleproto is heavy — keep it out of the shared remotes/catchall function
	split: true,
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.isAdminSession) {
		error(403, `Admin only`);
	}

	const body = await request.json().catch(() => null);
	const roomId = typeof body?.roomId === `string` ? body.roomId.trim() : ``;
	if (!roomId) {
		error(400, `roomId ist erforderlich`);
	}

	try {
		const resolved = await resolveTelegramScrapingTarget({ roomId });
		return json(resolved);
	} catch (err) {
		console.error(`Failed to resolve Telegram room:`, err);
		const message = err instanceof Error ? err.message : `Telegram-Raum konnte nicht verifiziert werden`;
		// Always JSON so the remote's internal fetch (which may forward Accept: text/html) can read `message`.
		return json({ message }, { status: 400 });
	}
};
