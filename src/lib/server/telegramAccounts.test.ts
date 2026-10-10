import { describe, expect, it } from 'vitest';
import {
	isTelegramAccessError,
	parseTelegramAccountSessions,
	TelegramAccountRoomCache,
	telegramAccountTryOrder,
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

describe(`telegramAccountTryOrder`, () => {
	it(`defaults to primary then fallback`, () => {
		expect(
			telegramAccountTryOrder({
				accountIds: [`primary`, `fallback`],
			}),
		).toEqual([`primary`, `fallback`]);
	});

	it(`uses only the sticky cached account for the rest of the run`, () => {
		expect(
			telegramAccountTryOrder({
				accountIds: [`primary`, `fallback`],
				cachedId: `fallback`,
			}),
		).toEqual([`fallback`]);
	});

	it(`honors TELEGRAM_SCRAPE_ACCOUNT_ORDER`, () => {
		expect(
			telegramAccountTryOrder({
				accountIds: [`primary`, `fallback`],
				orderEnv: `fallback,primary`,
			}),
		).toEqual([`fallback`, `primary`]);
	});

	it(`ignores cached ids that are not available`, () => {
		expect(
			telegramAccountTryOrder({
				accountIds: [`fallback`],
				cachedId: `primary`,
			}),
		).toEqual([`fallback`]);
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

describe(`TelegramAccountRoomCache`, () => {
	it(`remembers account ids for multiple room id aliases`, () => {
		const cache = new TelegramAccountRoomCache();
		cache.remember({
			roomIds: [`resolveName:Foo`, `-100123`],
			accountId: `fallback`,
		});
		expect(cache.get(`resolveName:Foo`)).toBe(`fallback`);
		expect(cache.get(`-100123`)).toBe(`fallback`);
		expect(cache.get(`other`)).toBeUndefined();
	});
});
