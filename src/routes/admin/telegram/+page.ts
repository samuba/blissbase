import { getTelegramScrapingTargets } from "$lib/rpc/adminTelegram.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const targets = await getTelegramScrapingTargets();
	return { targets };
}) satisfies PageLoad;
