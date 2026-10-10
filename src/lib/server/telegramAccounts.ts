export type TelegramAccountId = `primary` | `fallback`

export type TelegramAccountSession = {
	id: TelegramAccountId
	session: string
}

const ACCESS_ERROR_MARKERS = [
	`Could not find Telegram entity`,
	`must be a member`,
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
 * Builds the scraper account list from env.
 * PRIMARY = new number; FALLBACK = old number.
 * Legacy TELEGRAM_APP_SESSION fills FALLBACK when FALLBACK is unset.
 */
export function parseTelegramAccountSessions(env: {
	TELEGRAM_APP_SESSION_PRIMARY?: string | undefined
	TELEGRAM_APP_SESSION_FALLBACK?: string | undefined
	TELEGRAM_APP_SESSION?: string | undefined
}): TelegramAccountSession[] {
	const primary = env.TELEGRAM_APP_SESSION_PRIMARY?.trim() || ``
	const fallbackExplicit = env.TELEGRAM_APP_SESSION_FALLBACK?.trim() || ``
	const legacy = env.TELEGRAM_APP_SESSION?.trim() || ``
	const fallback = fallbackExplicit || legacy

	const accounts: TelegramAccountSession[] = []
	if (primary) {
		accounts.push({ id: `primary`, session: primary })
	}
	if (fallback && fallback !== primary) {
		accounts.push({ id: `fallback`, session: fallback })
	}
	return accounts
}

/**
 * Try order for resolving a chat.
 * Sticky cache hit → only that account (never scrape the same chat with both in one run).
 * Otherwise PRIMARY then FALLBACK (or TELEGRAM_SCRAPE_ACCOUNT_ORDER).
 */
export function telegramAccountTryOrder(args: {
	accountIds: TelegramAccountId[]
	cachedId?: TelegramAccountId
	orderEnv?: string | undefined
}): TelegramAccountId[] {
	const available = new Set(args.accountIds)
	if (!available.size) return []

	if (args.cachedId && available.has(args.cachedId)) {
		return [args.cachedId]
	}

	const fromEnv = args.orderEnv
		?.split(`,`)
		.map((part) => part.trim())
		.filter((part): part is TelegramAccountId => part === `primary` || part === `fallback`)

	const base: TelegramAccountId[] = []
	for (const id of fromEnv?.length ? fromEnv : [`primary` as const, `fallback` as const]) {
		if (!available.has(id)) continue
		if (base.includes(id)) continue
		base.push(id)
	}
	for (const id of args.accountIds) {
		if (base.includes(id)) continue
		base.push(id)
	}
	return base
}

export function isTelegramAccessError(err: unknown): boolean {
	if (err instanceof Error && err.message.includes(`FATAL->EXIT`)) return false

	const message = err instanceof Error ? err.message : String(err)
	const rpcMessage =
		typeof err === `object` && err && `errorMessage` in err
			? String((err as { errorMessage: unknown }).errorMessage)
			: ``
	const haystack = `${message} ${rpcMessage}`
	return ACCESS_ERROR_MARKERS.some((marker) => haystack.includes(marker))
}

/** Sticky roomId → account for one scrape run. */
export class TelegramAccountRoomCache {
	#byRoom = new Map<string, TelegramAccountId>()

	get(roomId: string) {
		return this.#byRoom.get(roomId)
	}

	remember(args: { roomIds: string[]; accountId: TelegramAccountId }) {
		for (const roomId of args.roomIds) {
			if (!roomId) continue
			this.#byRoom.set(roomId, args.accountId)
		}
	}
}

export function missingTelegramSessionConfigMessage() {
	return `Telegram scraper credentials are not configured. Set TELEGRAM_APP_ID, TELEGRAM_APP_HASH, and at least one of TELEGRAM_APP_SESSION_PRIMARY, TELEGRAM_APP_SESSION_FALLBACK, or legacy TELEGRAM_APP_SESSION.`
}
