import type { PageLoad } from "./$types";
import {
	getAvailableTelegramDialogs,
	getTelegramScrapingTargets,
} from "./adminTelegram.remote";

export const load = (async () => {
	const targets = await getTelegramScrapingTargets();

	// Soft-fail: targets should still load if PRIMARY session is missing / Telegram is down.
	const availableDialogs = await getAvailableTelegramDialogs().catch((err) => {
		console.error(`Failed to load available Telegram dialogs:`, err);
		return [];
	});

	return { targets, availableDialogs };
}) satisfies PageLoad;
