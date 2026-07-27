import { env } from '$env/dynamic/private';
import { extractTelegramRoomIdFromInput } from '$lib/telegramCommon';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

/**
 * Confirms a Telegram room/channel exists for the scraper session and returns its display name.
 */
export async function resolveTelegramScrapingTarget({ roomId }: { roomId: string }) {
	const apiId = Number(env.TELEGRAM_APP_ID);
	const apiHash = env.TELEGRAM_APP_HASH?.trim();
	const sessionAuthKeyString = env.TELEGRAM_APP_SESSION?.trim();

	if (!apiId || !apiHash || !sessionAuthKeyString) {
		throw new Error(`Telegram scraper credentials are not configured (TELEGRAM_APP_ID/HASH/SESSION)`);
	}

	const normalizedRoomId = extractTelegramRoomIdFromInput(roomId);

	const client = new TelegramClient(new StringSession(sessionAuthKeyString), apiId, apiHash, {
		connectionRetries: 5,
	});

	try {
		await client.connect();
		const authorized = await client.checkAuthorization();
		if (!authorized) {
			throw new Error(
				`TELEGRAM_APP_SESSION is invalid or expired. Run scripts/telegram-login.ts and update TELEGRAM_APP_SESSION in .env`,
			);
		}

		// Warm entity cache so numeric IDs can be resolved (teleproto needs access hashes).
		const dialogs = await client.getDialogs({});

		let resolvedRoomId = normalizedRoomId;
		if (resolvedRoomId.includes(`resolveName:`)) {
			const chatName = resolvedRoomId.split(`:`)[1]?.trim();
			if (!chatName) {
				throw new Error(`resolveName: requires a chat name`);
			}

			const chatId = findDialogIdByName({ dialogs, name: chatName });
			if (!chatId) {
				throw new Error(`No chat found for name "${chatName}". Is the scraper account a member?`);
			}
			resolvedRoomId = chatId;
		}

		const entity = await resolveEntity({ client, dialogs, roomId: resolvedRoomId });
		return {
			roomId: entity.id?.toString() ?? resolvedRoomId,
			name: getEntityName(entity),
		};
	} finally {
		await client.disconnect();
	}
}

async function resolveEntity(args: {
	client: TelegramClient;
	dialogs: Awaited<ReturnType<TelegramClient[`getDialogs`]>>;
	roomId: string;
}) {
	const { client, dialogs, roomId } = args;

	const fromDialogs = findDialogEntity({ dialogs, roomId });
	if (fromDialogs) return fromDialogs;

	for (const candidate of entityLookupCandidates(roomId)) {
		try {
			return await client.getEntity(candidate);
		} catch {
			continue;
		}
	}

	throw new Error(
		`Could not find Telegram entity for "${roomId}". Use @username, resolveName:Chat Title, or the full chat id (e.g. -100…). The scraper account must be a member of the chat.`,
	);
}

function entityLookupCandidates(roomId: string) {
	const trimmed = roomId.trim();
	const candidates: Array<string | number> = [trimmed];

	if (trimmed.startsWith(`@`)) {
		candidates.push(trimmed.slice(1));
		return candidates;
	}

	if (!/^-?\d+$/.test(trimmed)) {
		candidates.push(`@${trimmed}`);
		return candidates;
	}

	const asNumber = Number(trimmed);
	candidates.push(asNumber);

	// Positive IDs are often channel IDs without the -100 prefix.
	if (asNumber > 0) {
		candidates.push(`-100${trimmed}`);
		candidates.push(Number(`-100${trimmed}`));
		candidates.push(`-${trimmed}`);
		candidates.push(-asNumber);
	}

	return candidates;
}

function findDialogEntity(args: {
	dialogs: Awaited<ReturnType<TelegramClient[`getDialogs`]>>;
	roomId: string;
}) {
	const wanted = new Set(
		entityLookupCandidates(args.roomId).map((candidate) => candidate.toString()),
	);

	for (const dialog of args.dialogs) {
		const dialogId = dialog.id?.toString();
		if (!dialogId || !wanted.has(dialogId)) continue;
		if (dialog.entity) return dialog.entity;
	}
}

function findDialogIdByName(args: {
	dialogs: Awaited<ReturnType<TelegramClient[`getDialogs`]>>;
	name: string;
}) {
	for (const dialog of args.dialogs) {
		if (dialog.name !== args.name) continue;
		return dialog.id?.toString();
	}
}

function getEntityName(entity: unknown) {
	const entityObj = entity as Record<string, unknown>;
	if (`title` in entityObj) {
		return entityObj.title as string;
	}
	if (`username` in entityObj) {
		return (entityObj.username as string) || `Unknown`;
	}
	if (`firstName` in entityObj) {
		return `${entityObj.firstName as string} ${(entityObj.lastName as string) || ``}`.trim();
	}
	return `Unknown`;
}
