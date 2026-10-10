import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions'

// teleproto reconnects forever when Telegram rejects an auth key, so connect() alone may never settle.
const CONNECT_TIMEOUT_MS = 60_000

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

/**
 * Connects every configured session. Throws if any one fails to connect or isn't authorized
 * (expired, revoked, needs interactive login) — a bad session must fail the run, not be skipped.
 */
export async function connectTelegramAccounts(args: {
	apiId: number
	apiHash: string
	sessions: { id: TelegramAccountId; session: string }[]
}) {
	const accounts: { id: TelegramAccountId; client: TelegramClient }[] = []
	for (const { id, session } of args.sessions) {
		try {
			const client = new TelegramClient(new StringSession(session), args.apiId, args.apiHash, {
				connectionRetries: 5,
			})
			accounts.push({ id, client })
			await withTimeout({
				ms: CONNECT_TIMEOUT_MS,
				message: `timed out after ${CONNECT_TIMEOUT_MS / 1000}s connecting`,
				promise: (async () => {
					await client.connect()
					if (!(await client.checkAuthorization())) throw new Error(`not authorized`)
				})(),
			})
		} catch (err) {
			await Promise.allSettled(accounts.map(({ client }) => client.disconnect()))
			const message = err instanceof Error ? err.message : String(err)
			throw new Error(
				`Telegram session "${id}" is unusable (${message}). Mint a new one with scripts/telegram-login.ts and update its secret.`,
			)
		}
	}
	return accounts
}

async function withTimeout<T>(args: { promise: Promise<T>; ms: number; message: string }) {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(args.message)), args.ms)
	})
	try {
		return await Promise.race([args.promise, timeout])
	} finally {
		clearTimeout(timer)
	}
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
