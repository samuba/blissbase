import type { PageLoad } from "./$types";
import {
	getAvailableTelegramDialogs,
	getTelegramScrapingTargets,
} from "./adminTelegram.remote";

export const load = (async () => {
	const targets = await getTelegramScrapingTargets();

	// Soft-fail: targets should still load if sessions are missing / Telegram is down.
	// Keep the error message so the picker empty-state can show the real cause.
	let availableDialogsError: string | null = null;
	const availableDialogs = await getAvailableTelegramDialogs().catch((err) => {
		console.error(`Failed to load available Telegram dialogs:`, err);
		availableDialogsError = dialogsLoadErrorMessage(err);
		return { accounts: [], dialogs: [] };
	});

	return { targets, availableDialogs, availableDialogsError };
}) satisfies PageLoad;

function dialogsLoadErrorMessage(err: unknown) {
	if (err instanceof Error && err.message.trim()) return err.message;
	if (typeof err === `object` && err && `body` in err) {
		const body = (err as { body?: { message?: string } }).body;
		if (body?.message?.trim()) return body.message;
	}
	return `Telegram-Dialoge konnten nicht geladen werden`;
}
