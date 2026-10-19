import * as v from 'valibot'

/**
 * Maps a scrape-account dialog to an admin picker candidate.
 * Skips users/bots and forbidden chats; keeps groups and channels only.
 * `dialog.id` is already the marked peer id from teleproto (`utils.getPeerId`).
 */
export function availableTelegramDialogFromDialog(
	dialog: {
		isUser: boolean
		isGroup: boolean
		isChannel: boolean
		id?: { toString(): string } | null
		name?: string | null
		title?: string | null
		date?: number
		entity?: { className?: string; username?: string | null } | null
	},
	accountId: TelegramDialogAccountId,
): AvailableTelegramDialog | null {
	if (dialog.isUser) return null
	if (!dialog.isGroup && !dialog.isChannel) return null

	const entity = dialog.entity
	if (!entity) return null
	if (entity.className === `ChatForbidden` || entity.className === `ChannelForbidden`) {
		return null
	}

	const roomId = dialog.id?.toString()
	if (!roomId) return null

	const kind: AvailableTelegramDialog[`kind`] =
		dialog.isChannel && !dialog.isGroup ? `channel` : `group`

	const username =
		entity.className === `Channel` && typeof entity.username === `string` && entity.username.trim()
			? entity.username.trim()
			: null

	const name = (dialog.name ?? dialog.title)?.trim() || username || roomId

	return {
		roomId,
		name,
		kind,
		username,
		accountId,
		lastMessageTime: dialog.date ? new Date(dialog.date * 1000) : null,
	}
}

export function excludeExistingTelegramTargets(args: {
	dialogs: AvailableTelegramDialog[]
	existingRoomIds: string[]
}) {
	if (!args.existingRoomIds.length) return args.dialogs

	const existing = new Set(args.existingRoomIds)
	return args.dialogs.filter((dialog) => !existing.has(dialog.roomId))
}

/**
 * Validates the `/admin/telegram/dialogs` JSON. Returns null on a shape mismatch, e.g. when
 * the split function and the remote run different deployments.
 */
export function parseTelegramDialogsResponse(body: unknown) {
	const result = v.safeParse(telegramDialogsResponseSchema, body)
	return result.success ? result.output : null
}

export function telegramAccountLabel(accountId: TelegramDialogAccountId) {
	return accountId === `primary` ? `Primär` : `Sekundär`
}

const accountIdSchema = v.picklist([`primary`, `fallback`])

const telegramDialogsResponseSchema = v.object({
	accounts: v.array(accountIdSchema),
	accountStatuses: v.array(
		v.object({
			accountId: accountIdSchema,
			listed: v.number(),
			error: v.nullable(v.string()),
		}),
	),
	dialogs: v.array(
		v.object({
			roomId: v.string(),
			name: v.string(),
			kind: v.picklist([`group`, `channel`]),
			username: v.nullable(v.string()),
			accountId: accountIdSchema,
			lastMessageTime: v.nullable(
				v.pipe(
					v.string(),
					v.isoTimestamp(),
					v.transform((value) => new Date(value)),
				),
			),
		}),
	),
})

export type TelegramDialogAccountId = v.InferOutput<typeof accountIdSchema>

export type AvailableTelegramDialog = {
	roomId: string
	name: string
	kind: `group` | `channel`
	username: string | null
	accountId: TelegramDialogAccountId
	lastMessageTime: Date | null
}
