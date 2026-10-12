import type { PageLoad } from "./$types";
import { getTelegramScrapingTargets } from "./adminTelegram.remote";

export const load = (async () => {
	// Only load targets here. Available Telegram dialogs are fetched when the
	// add dialog opens — listing via teleproto can take many seconds.
	const targets = await getTelegramScrapingTargets();
	return { targets };
}) satisfies PageLoad;
