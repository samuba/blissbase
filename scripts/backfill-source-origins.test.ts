import { describe, expect, it } from "vitest";
import {
	planSourceOriginsBackfill,
	sourceOriginsNeedBackfill,
} from "./backfill-source-origins";

describe(`planSourceOriginsBackfill`, () => {
	it(`derives a scrape origin from classic source fields`, () => {
		expect(
			planSourceOriginsBackfill({
				event: {
					source: `tribehaus`,
					sourceUrl: `https://tribehaus.com/e/1`,
					sourceOrigins: [],
				},
				telegramNames: new Map(),
				whatsappNames: new Map(),
			}),
		).toEqual([
			{
				type: `scrape`,
				label: `tribehaus`,
				chatId: null,
				url: `https://tribehaus.com/e/1`,
			},
		]);
	});

	it(`enriches telegram labels from room names when label is still the chat id`, () => {
		expect(
			planSourceOriginsBackfill({
				event: {
					source: `telegram`,
					sourceChatIdsTelegram: [`-1001`],
					sourceOrigins: [],
				},
				telegramNames: new Map([[`-1001`, `Berlin Conscious`]]),
				whatsappNames: new Map(),
			}),
		).toEqual([
			{
				type: `telegram`,
				label: `Berlin Conscious`,
				chatId: `-1001`,
				url: null,
			},
		]);
	});

	it(`keeps an explicit messenger label over the lookup name`, () => {
		expect(
			planSourceOriginsBackfill({
				event: {
					source: `whatsapp`,
					sourceChatIdsWhatsapp: [`jid@g.us`],
					sourceOrigins: [
						{
							type: `whatsapp`,
							label: `Already Named`,
							chatId: `jid@g.us`,
							url: null,
						},
					],
				},
				telegramNames: new Map(),
				whatsappNames: new Map([[`jid@g.us`, `Lookup Name`]]),
			}),
		).toEqual([
			{
				type: `whatsapp`,
				label: `Already Named`,
				chatId: `jid@g.us`,
				url: null,
			},
		]);
	});

	it(`merges classic fields with existing origins`, () => {
		expect(
			planSourceOriginsBackfill({
				event: {
					source: `heilnetz`,
					sourceUrl: `https://heilnetz.de/e`,
					sourceChatIdsTelegram: [`room1`],
					sourceOrigins: [{ type: `telegram`, label: `Room 1`, chatId: `room1` }],
				},
				telegramNames: new Map([[`room1`, `Room 1`]]),
				whatsappNames: new Map(),
			}),
		).toEqual([
			{
				type: `scrape`,
				label: `heilnetz`,
				chatId: null,
				url: `https://heilnetz.de/e`,
			},
			{
				type: `telegram`,
				label: `Room 1`,
				chatId: `room1`,
				url: null,
			},
		]);
	});
});

describe(`sourceOriginsNeedBackfill`, () => {
	it(`is false when stored already matches planned`, () => {
		const planned = [
			{ type: `scrape` as const, label: `tribehaus`, chatId: null, url: `https://x` },
		];
		expect(sourceOriginsNeedBackfill({ stored: planned, planned })).toBe(false);
	});

	it(`is true when stored is empty`, () => {
		expect(
			sourceOriginsNeedBackfill({
				stored: [],
				planned: [{ type: `scrape`, label: `tribehaus`, chatId: null, url: null }],
			}),
		).toBe(true);
	});
});
