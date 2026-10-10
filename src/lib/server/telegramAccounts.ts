const ACCESS_ERROR_MARKERS = [
	`Could not find Telegram entity`,
	`No chat found for name`,
	`CHANNEL_PRIVATE`,
	`CHAT_ID_INVALID`,
	`PEER_ID_INVALID`,
	`USER_NOT_PARTICIPANT`,
	`CHANNEL_INVALID`,
	`CHAT_INVALID`,
	`USERNAME_NOT_OCCUPIED`,
	`USERNAME_INVALID`,
	// A dead session can't access anything either — let the other account take over.
	`AUTH_KEY_UNREGISTERED`,
	`SESSION_REVOKED`,
	`USER_DEACTIVATED`,
	`is invalid or expired`,
]

/**
 * Builds the scraper account list from env, in try order.
 * PRIMARY = new number; FALLBACK = old number.
 * Legacy TELEGRAM_APP_SESSION fills FALLBACK when FALLBACK is unset.
 */
export function parseTelegramAccountSessions(env: {
	TELEGRAM_APP_SESSION_PRIMARY?: string
	TELEGRAM_APP_SESSION_FALLBACK?: string
	TELEGRAM_APP_SESSION?: string
}) {
	const primary = env.TELEGRAM_APP_SESSION_PRIMARY?.trim()
	const fallback = env.TELEGRAM_APP_SESSION_FALLBACK?.trim() || env.TELEGRAM_APP_SESSION?.trim()

	const accounts: { id: TelegramAccountId; session: string }[] = []
	if (primary) accounts.push({ id: `primary`, session: primary })
	if (fallback && fallback !== primary) accounts.push({ id: `fallback`, session: fallback })
	return accounts
}

export function isTelegramAccessError(err: unknown) {
	const message = err instanceof Error ? err.message : String(err)
	if (message.includes(`FATAL->EXIT`)) return false

	const rpcMessage =
		typeof err === `object` && err && `errorMessage` in err ? String(err.errorMessage) : ``
	return ACCESS_ERROR_MARKERS.some((marker) => `${message} ${rpcMessage}`.includes(marker))
}

/**
 * Runs `attempt` with each account in order and returns the first success.
 * Only access errors move on to the next account; anything else is rethrown.
 */
export async function withFirstAccessibleAccount<TAccount extends { id: TelegramAccountId }, TResult>(args: {
	accounts: TAccount[]
	target: string
	attempt: (account: TAccount) => Promise<TResult>
}) {
	const misses: string[] = []
	for (const account of args.accounts) {
		try {
			return await args.attempt(account)
		} catch (err) {
			if (!isTelegramAccessError(err)) throw err
			const message = err instanceof Error ? err.message : String(err)
			console.log(`Telegram account "${account.id}" cannot access ${args.target}: ${message}`)
			misses.push(`[${account.id}] ${message}`)
		}
	}
	throw new Error(`No Telegram scraper account can access "${args.target}". ${misses.join(` `)}`)
}

export function missingTelegramSessionConfigMessage() {
	return `Telegram scraper credentials are not configured. Set TELEGRAM_APP_ID, TELEGRAM_APP_HASH, and at least one of TELEGRAM_APP_SESSION_PRIMARY, TELEGRAM_APP_SESSION_FALLBACK, or legacy TELEGRAM_APP_SESSION.`
}

export type TelegramAccountId = `primary` | `fallback`
