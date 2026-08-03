import {
	getAvailableWhatsappChats,
	getWhatsappScrapingTargets,
} from "$lib/rpc/adminWhatsapp.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const [targets, availableChats] = await Promise.all([
		getWhatsappScrapingTargets(),
		getAvailableWhatsappChats(),
	]);

	return { targets, availableChats };
}) satisfies PageLoad;
