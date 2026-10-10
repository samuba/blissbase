import { describe, expect, it } from 'vitest';
import {
	isTelegramAccessError,
	parseTelegramAccountSessions,
	withFirstAccessibleAccount,
} from './telegramAccounts';

describe(`parseTelegramAccountSessions`, () => {
	it(`uses PRIMARY and FALLBACK when both are set`, () => {
		expect(
			parseTelegramAccountSessions({
				TELEGRAM_APP_SESSION_PRIMARY: ` primary-session `,
				TELEGRAM_APP_SESSION_FALLBACK: ` fallback-session `,
				TELEGRAM_APP_SESSION: `legacy-ignored`,
			}),
		).toEqual([
			{ id: `primary`, session: `primary-session` },
			{ id: `fallback`, session: `fallback-session` },
		]);
	});

	it(`maps legacy TELEGRAM_APP_SESSION to FALLBACK when FALLBACK is unset`, () => {
		expect(
			parseTelegramAccountSessions({
				TELEGRAM_APP_SESSION_PRIMARY: `primary-session`,
				TELEGRAM_APP_SESSION: `legacy-session`,
			}),
		).toEqual([
			{ id: `primary`, session: `primary-session` },
			{ id: `fallback`, session: `legacy-session` },
		]);
	});

	it(`treats legacy-only as FALLBACK (current single-account behavior)`, () => {
		expect(
			parseTelegramAccountSessions({
				TELEGRAM_APP_SESSION: `legacy-session`,
			}),
		).toEqual([{ id: `fallback`, session: `legacy-session` }]);
	});

	it(`skips duplicate session strings`, () => {
		expect(
			parseTelegramAccountSessions({
				TELEGRAM_APP_SESSION_PRIMARY: `same`,
				TELEGRAM_APP_SESSION_FALLBACK: `same`,
			}),
		).toEqual([{ id: `primary`, session: `same` }]);
	});

	it(`returns empty when no sessions are configured`, () => {
		expect(parseTelegramAccountSessions({})).toEqual([]);
	});
});

describe(`isTelegramAccessError`, () => {
	it(`detects membership / private channel failures`, () => {
		expect(
			isTelegramAccessError(
				new Error(`Could not find Telegram entity for "-1001". The scraper account must be a member of the chat.`),
			),
		).toBe(true);
		expect(isTelegramAccessError(new Error(`CHANNEL_PRIVATE`))).toBe(true);
		expect(isTelegramAccessError({ errorMessage: `USER_NOT_PARTICIPANT` })).toBe(true);
		expect(isTelegramAccessError(new Error(`Telegram session for account "primary" is invalid or expired.`))).toBe(true);
		expect(isTelegramAccessError(new Error(`No chat found for name "Foo". Is the scraper account a member?`))).toBe(
			true,
		);
	});

	it(`does not treat fatal or unrelated errors as access misses`, () => {
		expect(isTelegramAccessError(new Error(`FATAL->EXIT: forum but no topicIds`))).toBe(false);
		expect(isTelegramAccessError(new Error(`telegram file reference expired`))).toBe(false);
		expect(isTelegramAccessError(new Error(`R2 upload failed`))).toBe(false);
	});
});

describe(`withFirstAccessibleAccount`, () => {
	const accounts = [{ id: `primary` as const }, { id: `fallback` as const }];

	it(`uses primary when it can access the chat`, async () => {
		const tried: string[] = [];
		const result = await withFirstAccessibleAccount({
			accounts,
			target: `-1001`,
			attempt: async ({ id }) => {
				tried.push(id);
				return id;
			},
		});
		expect(result).toBe(`primary`);
		expect(tried).toEqual([`primary`]);
	});

	it(`falls back on access errors`, async () => {
		const result = await withFirstAccessibleAccount({
			accounts,
			target: `-1001`,
			attempt: async ({ id }) => {
				if (id === `primary`) throw new Error(`CHANNEL_PRIVATE`);
				return id;
			},
		});
		expect(result).toBe(`fallback`);
	});

	it(`does not fall back on unrelated errors`, async () => {
		const tried: string[] = [];
		await expect(
			withFirstAccessibleAccount({
				accounts,
				target: `-1001`,
				attempt: async ({ id }) => {
					tried.push(id);
					throw new Error(`FATAL->EXIT: forum but no topicIds`);
				},
			}),
		).rejects.toThrow(`FATAL->EXIT`);
		expect(tried).toEqual([`primary`]);
	});

	it(`reports every account's miss when none can access`, async () => {
		await expect(
			withFirstAccessibleAccount({
				accounts,
				target: `-1001`,
				attempt: async ({ id }) => {
					throw new Error(id === `primary` ? `USER_NOT_PARTICIPANT` : `CHANNEL_PRIVATE`);
				},
			}),
		).rejects.toThrow(`No Telegram scraper account can access "-1001". [primary] USER_NOT_PARTICIPANT [fallback] CHANNEL_PRIVATE`);
	});
});
