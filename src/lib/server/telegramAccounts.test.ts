import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	connectTelegramAccounts,
	isTelegramAccessError,
	parseTelegramAccountSessions,
	withFirstAccessibleAccount,
} from './telegramAccounts';

const teleproto = vi.hoisted(() => ({
	authorizedBySession: new Map<string, boolean | Error | `hang`>(),
	disconnect: vi.fn(),
}));

vi.mock(`teleproto/sessions`, () => ({
	StringSession: class {
		constructor(public value: string) {}
	},
}));

vi.mock(`teleproto/extensions/Logger`, () => ({
	LogLevel: { NONE: `none` },
}));

vi.mock(`teleproto`, () => ({
	TelegramClient: class {
		constructor(public session: { value: string }) {}
		async connect() {
			const state = teleproto.authorizedBySession.get(this.session.value);
			if (state === `hang`) return new Promise(() => {});
			if (state instanceof Error) throw state;
		}
		async checkAuthorization() {
			return teleproto.authorizedBySession.get(this.session.value) === true;
		}
		setLogLevel = vi.fn();
		disconnect = teleproto.disconnect;
	},
}));

describe(`connectTelegramAccounts`, () => {
	const sessions = [
		{ id: `primary` as const, session: `p` },
		{ id: `fallback` as const, session: `f` },
	];

	beforeEach(() => {
		teleproto.authorizedBySession.clear();
		teleproto.disconnect.mockClear();
	});

	it(`connects all authorized sessions in order`, async () => {
		teleproto.authorizedBySession.set(`p`, true).set(`f`, true);
		const accounts = await connectTelegramAccounts({ apiId: 1, apiHash: `h`, sessions });
		expect(accounts.map((account) => account.id)).toEqual([`primary`, `fallback`]);
	});

	it(`fails when any session is not authorized, even if another works`, async () => {
		teleproto.authorizedBySession.set(`p`, true).set(`f`, false);
		await expect(connectTelegramAccounts({ apiId: 1, apiHash: `h`, sessions })).rejects.toThrow(
			`Telegram session "fallback" is unusable (not authorized)`,
		);
		expect(teleproto.disconnect).toHaveBeenCalledTimes(2);
	});

	it(`fails when connecting never settles (rejected auth key reconnect loop)`, async () => {
		vi.useFakeTimers();
		teleproto.authorizedBySession.set(`p`, `hang`);
		const result = connectTelegramAccounts({ apiId: 1, apiHash: `h`, sessions });
		const assertion = expect(result).rejects.toThrow(`Telegram session "primary" is unusable (timed out after 60s connecting)`);
		await vi.advanceTimersByTimeAsync(60_000);
		await assertion;
		vi.useRealTimers();
	});

	it(`fails when a session cannot connect`, async () => {
		teleproto.authorizedBySession.set(`p`, new Error(`AUTH_KEY_UNREGISTERED`));
		await expect(connectTelegramAccounts({ apiId: 1, apiHash: `h`, sessions })).rejects.toThrow(
			`Telegram session "primary" is unusable (AUTH_KEY_UNREGISTERED)`,
		);
	});
});

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
		expect(isTelegramAccessError(new Error(`No chat found for name "Foo". Is the scraper account a member?`))).toBe(
			true,
		);
	});

	it(`does not treat fatal or unrelated errors as access misses`, () => {
		expect(isTelegramAccessError(new Error(`FATAL->EXIT: forum but no topicIds`))).toBe(false);
		expect(isTelegramAccessError(new Error(`telegram file reference expired`))).toBe(false);
		expect(isTelegramAccessError(new Error(`R2 upload failed`))).toBe(false);
	});

	it(`does not treat dead sessions as access misses`, () => {
		expect(isTelegramAccessError({ errorMessage: `AUTH_KEY_UNREGISTERED` })).toBe(false);
		expect(isTelegramAccessError(new Error(`SESSION_REVOKED`))).toBe(false);
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

	it(`falls back on access errors and logs the switch`, async () => {
		const log = vi.spyOn(console, `log`).mockImplementation(() => {});
		const result = await withFirstAccessibleAccount({
			accounts,
			target: `-1001`,
			attempt: async ({ id }) => {
				if (id === `primary`) throw new Error(`CHANNEL_PRIVATE`);
				return id;
			},
		});
		expect(result).toBe(`fallback`);
		expect(log).toHaveBeenCalledWith(
			`Telegram "primary" account cannot access -1001 (not a member / no access). Switching to "fallback".`,
		);
		expect(log).toHaveBeenCalledWith(
			`Using Telegram "fallback" for -1001 — switched after primary could not access it`,
		);
		log.mockRestore();
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
