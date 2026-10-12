import { env } from '$env/dynamic/private';
import {
	missingTelegramSessionConfigMessage,
	parseTelegramAccountSessions,
	type TelegramAccountId,
} from '$lib/server/telegramAccounts';
import { TelegramClient } from 'teleproto';
import { LogLevel } from 'teleproto/extensions/Logger';
import { StringSession } from 'teleproto/sessions';
import {
	availableTelegramDialogFromDialog,
	type AvailableTelegramDialog,
} from './availableDialogs';

/**
 * Lists groups/channels per configured scrape account (PRIMARY, then FALLBACK/legacy).
 * Each dialog is tagged with `accountId` so the admin picker can filter by account.
 */
export async function listPrimaryTelegramGroupDialogs(): Promise<{
	accounts: TelegramAccountId[]
	dialogs: AvailableTelegramDialog[]
}> {
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

	const accountIds = accounts.map((account) => account.id);
	const available: AvailableTelegramDialog[] = [];
	const accountErrors: string[] = [];

	for (const account of accounts) {
		try {
			const listed = await listDialogsForSession({
				apiId,
				apiHash,
				session: account.session,
				accountId: account.id,
			});
			available.push(...listed);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed listing Telegram dialogs for ${account.id}:`, err);
			accountErrors.push(`${account.id}: ${message}`);
		}
	}

	if (!available.length && accountErrors.length) {
		throw new Error(accountErrors.join(`; `));
	}

	available.sort((a, b) => {
		const accountCmp = a.accountId.localeCompare(b.accountId);
		if (accountCmp !== 0) return accountCmp;
		const aTime = a.lastMessageTime?.getTime() ?? 0;
		const bTime = b.lastMessageTime?.getTime() ?? 0;
		if (aTime !== bTime) return bTime - aTime;
		return a.name.localeCompare(b.name, `de`, { sensitivity: `base` });
	});

	return { accounts: accountIds, dialogs: available };
}

async function listDialogsForSession(args: {
	apiId: number
	apiHash: string
	session: string
	accountId: TelegramAccountId
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
				const mapped = availableTelegramDialogFromDialog(dialog, args.accountId);
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
