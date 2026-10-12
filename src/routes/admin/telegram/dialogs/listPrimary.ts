import { env } from '$env/dynamic/private';
import {
	missingTelegramSessionConfigMessage,
	parseTelegramAccountSessions,
} from '$lib/server/telegramAccounts';
import { TelegramClient } from 'teleproto';
import { LogLevel } from 'teleproto/extensions/Logger';
import { StringSession } from 'teleproto/sessions';
import {
	availableTelegramDialogFromDialog,
	type AvailableTelegramDialog,
} from './availableDialogs';

/**
 * Lists groups/channels from configured scrape accounts (PRIMARY then FALLBACK/legacy).
 * Merges by roomId so membership on either account shows up in the admin picker.
 * Per-account failures are skipped so one bad session does not hide the other's dialogs.
 */
export async function listPrimaryTelegramGroupDialogs(): Promise<AvailableTelegramDialog[]> {
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

	const byRoomId = new Map<string, AvailableTelegramDialog>();
	const accountErrors: string[] = [];

	for (const account of accounts) {
		try {
			const listed = await listDialogsForSession({
				apiId,
				apiHash,
				session: account.session,
				accountId: account.id,
			});
			for (const dialog of listed) {
				const existing = byRoomId.get(dialog.roomId);
				if (!existing) {
					byRoomId.set(dialog.roomId, dialog);
					continue;
				}
				const existingTime = existing.lastMessageTime?.getTime() ?? 0;
				const nextTime = dialog.lastMessageTime?.getTime() ?? 0;
				if (nextTime > existingTime) byRoomId.set(dialog.roomId, dialog);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed listing Telegram dialogs for ${account.id}:`, err);
			accountErrors.push(`${account.id}: ${message}`);
		}
	}

	if (!byRoomId.size && accountErrors.length) {
		throw new Error(accountErrors.join(`; `));
	}

	const available = [...byRoomId.values()];
	available.sort((a, b) => {
		const aTime = a.lastMessageTime?.getTime() ?? 0;
		const bTime = b.lastMessageTime?.getTime() ?? 0;
		if (aTime !== bTime) return bTime - aTime;
		return a.name.localeCompare(b.name, `de`, { sensitivity: `base` });
	});

	return available;
}

async function listDialogsForSession(args: {
	apiId: number
	apiHash: string
	session: string
	accountId: string
}) {
	const client = new TelegramClient(new StringSession(args.session), args.apiId, args.apiHash, {
		connectionRetries: 5,
	});

	try {
		await client.connect();
		const authorized = await client.checkAuthorization();
		if (!authorized) {
			throw new Error(
				`Telegram session for account "${args.accountId}" is invalid or expired. Run scripts/telegram-login.ts and update the matching TELEGRAM_APP_SESSION_* env.`,
			);
		}
		client.setLogLevel(LogLevel.NONE);

		const dialogs = await client.getDialogs({ ignoreMigrated: true });
		const available: AvailableTelegramDialog[] = [];
		for (const dialog of dialogs) {
			try {
				const mapped = availableTelegramDialogFromDialog(dialog);
				if (!mapped) continue;
				available.push(mapped);
			} catch (err) {
				console.error(`Skipping Telegram dialog while listing (${args.accountId}):`, err);
			}
		}
		return available;
	} finally {
		await client.disconnect();
	}
}
