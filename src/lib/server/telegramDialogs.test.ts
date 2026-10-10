import { describe, expect, it } from 'vitest'
import {
	availableTelegramDialogFromDialog,
	excludeExistingTelegramTargets,
} from './telegramDialogs'

describe(`availableTelegramDialogFromDialog`, () => {
	it(`maps megagroups as groups with peer roomId`, () => {
		const dialog = availableTelegramDialogFromDialog({
			isUser: false,
			isGroup: true,
			isChannel: true,
			id: `-100123456789`,
			name: `Conscious Events`,
			date: 1_700_000_000,
			entity: {
				className: `Channel`,
				username: `conscious_events`,
			},
		})

		expect(dialog).toMatchObject({
			roomId: `-100123456789`,
			name: `Conscious Events`,
			kind: `group`,
			username: `conscious_events`,
		})
		expect(dialog?.lastMessageTime?.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString())
	})

	it(`maps broadcast channels as channels`, () => {
		const dialog = availableTelegramDialogFromDialog({
			isUser: false,
			isGroup: false,
			isChannel: true,
			id: `-10099`,
			title: `News`,
			entity: {
				className: `Channel`,
			},
		})

		expect(dialog).toMatchObject({
			roomId: `-10099`,
			name: `News`,
			kind: `channel`,
			username: null,
		})
	})

	it(`maps basic chats as groups`, () => {
		const dialog = availableTelegramDialogFromDialog({
			isUser: false,
			isGroup: true,
			isChannel: false,
			id: `-42`,
			name: `Small group`,
			entity: {
				className: `Chat`,
			},
		})

		expect(dialog).toMatchObject({
			roomId: `-42`,
			name: `Small group`,
			kind: `group`,
			username: null,
		})
	})

	it(`skips users and forbidden chats`, () => {
		expect(
			availableTelegramDialogFromDialog({
				isUser: true,
				isGroup: false,
				isChannel: false,
				id: `1`,
				name: `Alice`,
				entity: { className: `User` },
			}),
		).toBeNull()

		expect(
			availableTelegramDialogFromDialog({
				isUser: false,
				isGroup: true,
				isChannel: false,
				id: `-7`,
				name: `Gone`,
				entity: { className: `ChatForbidden` },
			}),
		).toBeNull()
	})
})

describe(`excludeExistingTelegramTargets`, () => {
	it(`drops dialogs whose roomId is already a scraping target`, () => {
		const dialogs = [
			{
				roomId: `-1001`,
				name: `A`,
				kind: `group` as const,
				username: null,
				lastMessageTime: null,
			},
			{
				roomId: `-1002`,
				name: `B`,
				kind: `channel` as const,
				username: null,
				lastMessageTime: null,
			},
		]

		expect(
			excludeExistingTelegramTargets({
				dialogs,
				existingRoomIds: [`-1001`],
			}),
		).toEqual([dialogs[1]])
	})
})
