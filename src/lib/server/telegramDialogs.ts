/**
 * Maps a primary-account dialog to an admin picker candidate.
 * Skips users/bots and forbidden chats; keeps groups and channels only.
 * `dialog.id` is already the marked peer id from teleproto (`utils.getPeerId`).
 */
export function availableTelegramDialogFromDialog(dialog: {
	isUser: boolean
	isGroup: boolean
	isChannel: boolean
	id?: { toString(): string } | null
	name?: string | null
	title?: string | null
	date?: number
	entity?: { className?: string; username?: string | null } | null
}): AvailableTelegramDialog | null {
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

export type AvailableTelegramDialog = {
	roomId: string
	name: string
	kind: `group` | `channel`
	username: string | null
	lastMessageTime: Date | null
}
