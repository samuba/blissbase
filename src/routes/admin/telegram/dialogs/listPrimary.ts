import { env } from '$env/dynamic/private';
import { missingTelegramSessionConfigMessage } from '$lib/server/telegramAccounts';
import { TelegramClient } from 'teleproto';
import { LogLevel } from 'teleproto/extensions/Logger';
import { StringSession } from 'teleproto/sessions';
import {
	availableTelegramDialogFromDialog,
	type AvailableTelegramDialog,
} from './availableDialogs';

/**
 * Lists groups/channels the PRIMARY scrape account is a member of.
 * Does not use FALLBACK — the admin picker is intentionally primary-only.
 */
export async function listPrimaryTelegramGroupDialogs(): Promise<AvailableTelegramDialog[]> {
	const apiId = Number(env.TELEGRAM_APP_ID);
	const apiHash = env.TELEGRAM_APP_HASH?.trim();
	const primarySession = env.TELEGRAM_APP_SESSION_PRIMARY?.trim();

	if (!apiId || !apiHash) {
		throw new Error(missingTelegramSessionConfigMessage());
	}
	if (!primarySession) {
		throw new Error(
			`TELEGRAM_APP_SESSION_PRIMARY is required to list Telegram groups/channels. Mint a session with scripts/telegram-login.ts and set it on Vercel / .env.`,
		);
	}

	const client = new TelegramClient(new StringSession(primarySession), apiId, apiHash, {
		connectionRetries: 5,
	});

	try {
		await client.connect();
		const authorized = await client.checkAuthorization();
		if (!authorized) {
			throw new Error(
				`Telegram session for account "primary" is invalid or expired. Run scripts/telegram-login.ts and update TELEGRAM_APP_SESSION_PRIMARY in .env`,
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
				console.error(`Skipping Telegram dialog while listing:`, err);
			}
		}

		available.sort((a, b) => {
			const aTime = a.lastMessageTime?.getTime() ?? 0;
			const bTime = b.lastMessageTime?.getTime() ?? 0;
			if (aTime !== bTime) return bTime - aTime;
			return a.name.localeCompare(b.name, `de`, { sensitivity: `base` });
		});

		return available;
	} finally {
		await client.disconnect();
	}
}
