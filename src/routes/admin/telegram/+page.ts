import {
	getAvailableTelegramDialogs,
	getTelegramScrapingTargets,
} from "$lib/rpc/adminTelegram.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const targets = await getTelegramScrapingTargets();

	// Soft-fail: targets should still load if PRIMARY session is missing / Telegram is down.
	const availableDialogs = await getAvailableTelegramDialogs().catch((err) => {
		console.error(`Failed to load available Telegram dialogs:`, err);
		return [];
	});

	return { targets, availableDialogs };
}) satisfies PageLoad;
