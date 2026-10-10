import { env } from '$env/dynamic/private';
import { extractTelegramRoomIdFromInput, telegramEntityLookupCandidates } from '$lib/telegramCommon';
import { TelegramClient, utils } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import {
	missingTelegramSessionConfigMessage,
	parseTelegramAccountSessions,
	withFirstAccessibleAccount,
	type TelegramAccountId,
} from './telegramAccounts';

/**
 * Confirms a Telegram room/channel exists for a scraper session and returns its display name.
 * Tries PRIMARY then FALLBACK (legacy TELEGRAM_APP_SESSION maps to FALLBACK when unset).
 */
export async function resolveTelegramScrapingTarget({ roomId }: { roomId: string }) {
	const apiId = Number(env.TELEGRAM_APP_ID);
	const apiHash = env.TELEGRAM_APP_HASH?.trim();
	const accounts = parseTelegramAccountSessions({
		TELEGRAM_APP_SESSION_PRIMARY: env.TELEGRAM_APP_SESSION_PRIMARY,
		TELEGRAM_APP_SESSION_FALLBACK: env.TELEGRAM_APP_SESSION_FALLBACK,
		TELEGRAM_APP_SESSION: env.TELEGRAM_APP_SESSION,
	});

	if (!apiId || !apiHash || !accounts.length) {
		throw new Error(missingTelegramSessionConfigMessage());
	}

	const normalizedRoomId = extractTelegramRoomIdFromInput(roomId);
	return withFirstAccessibleAccount({
		accounts,
		target: normalizedRoomId,
		attempt: (account) =>
			resolveWithSession({
				apiId,
				apiHash,
				session: account.session,
				accountId: account.id,
				roomId: normalizedRoomId,
			}),
	});
}

async function resolveWithSession(args: {
	apiId: number
	apiHash: string
	session: string
	accountId: TelegramAccountId
	roomId: string
}) {
	const client = new TelegramClient(new StringSession(args.session), args.apiId, args.apiHash, {
		connectionRetries: 5,
	});

	try {
		await client.connect();
		const authorized = await client.checkAuthorization();
		if (!authorized) {
			throw new Error(
				`Telegram session for account "${args.accountId}" is invalid or expired. Run scripts/telegram-login.ts and update TELEGRAM_APP_SESSION_PRIMARY / TELEGRAM_APP_SESSION_FALLBACK (or legacy TELEGRAM_APP_SESSION) in .env`,
			);
		}

		// Warm entity cache so numeric IDs can be resolved (teleproto needs access hashes).
		const dialogs = await client.getDialogs({});

		let resolvedRoomId = args.roomId;
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
		// Channel.entity.id is the bare id; store Bot-API marked peer id (-100…) so the scraper can resolve it.
		return {
			roomId: utils.getPeerId(entity),
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

	for (const candidate of telegramEntityLookupCandidates(roomId)) {
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

function findDialogEntity(args: {
	dialogs: Awaited<ReturnType<TelegramClient[`getDialogs`]>>;
	roomId: string;
}) {
	const wanted = new Set(
		telegramEntityLookupCandidates(args.roomId).map((candidate) => candidate.toString()),
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
