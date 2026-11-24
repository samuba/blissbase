import { inArray } from "drizzle-orm";
import type { DB } from "./db.shared";
import { s } from "./db.shared";
import { WEBSITE_SCRAPER_CONFIG } from "../commonWithScripts";
import {
	ensureSourceOrigins,
	mergeSourceOrigins,
	type EventSourceOrigin,
} from "./eventSourceOrigins";

/**
 * Fills missing messenger display names and human scrape labels for admin UI.
 */
export async function resolveEventSourceOrigins(args: {
	db: DB;
	event: {
		source?: string | null;
		sourceUrl?: string | null;
		sourceChatIdsTelegram?: string[] | null;
		sourceChatIdsWhatsapp?: string[] | null;
		sourceOrigins?: EventSourceOrigin[] | null;
	};
}) {
	const origins = mergeSourceOrigins(ensureSourceOrigins(args.event));
	if (!origins.length) return origins;

	const telegramIds = origins
		.filter((origin) => origin.type === `telegram` && origin.chatId)
		.map((origin) => origin.chatId!);
	const whatsappIds = origins
		.filter((origin) => origin.type === `whatsapp` && origin.chatId)
		.map((origin) => origin.chatId!);

	const [telegramTargets, whatsappTargets, whatsappChats] = await Promise.all([
		telegramIds.length
			? args.db.query.telegramScrapingTargets.findMany({
					where: inArray(s.telegramScrapingTargets.roomId, telegramIds),
					columns: { roomId: true, name: true },
				})
			: Promise.resolve([]),
		whatsappIds.length
			? args.db.query.whatsappScrapingTargets.findMany({
					where: inArray(s.whatsappScrapingTargets.chatJid, whatsappIds),
					columns: { chatJid: true, name: true },
				})
			: Promise.resolve([]),
		whatsappIds.length
			? args.db.query.whatsappChats.findMany({
					where: inArray(s.whatsappChats.chatJid, whatsappIds),
					columns: { chatJid: true, name: true },
				})
			: Promise.resolve([]),
	]);

	const telegramNameById = new Map(
		telegramTargets.filter((row) => row.name?.trim()).map((row) => [row.roomId, row.name!.trim()] as const),
	);
	const whatsappNameById = new Map<string, string>();
	for (const row of whatsappChats) {
		if (row.name?.trim()) whatsappNameById.set(row.chatJid, row.name.trim());
	}
	for (const row of whatsappTargets) {
		if (row.name?.trim()) whatsappNameById.set(row.chatJid, row.name.trim());
	}

	return origins.map((origin) => {
		if (origin.type === `scrape`) {
			const config = WEBSITE_SCRAPER_CONFIG[origin.label as keyof typeof WEBSITE_SCRAPER_CONFIG];
			return {
				...origin,
				label: config?.label ?? origin.label,
			};
		}
		if (origin.type === `telegram` && origin.chatId) {
			const name = telegramNameById.get(origin.chatId);
			if (name && (origin.label === origin.chatId || !origin.label.trim())) {
				return { ...origin, label: name };
			}
		}
		if (origin.type === `whatsapp` && origin.chatId) {
			const name = whatsappNameById.get(origin.chatId);
			if (name && (origin.label === origin.chatId || !origin.label.trim())) {
				return { ...origin, label: name };
			}
		}
		if (origin.type === `website-form`) {
			return { ...origin, label: `Website-Formular` };
		}
		return origin;
	});
}
