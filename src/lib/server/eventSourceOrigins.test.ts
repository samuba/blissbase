import { describe, expect, it } from "vitest";
import {
	ensureSourceOrigins,
	mergeSourceOrigins,
	messengerSourceOrigin,
	sourceOriginKey,
} from "./eventSourceOrigins";

describe(`eventSourceOrigins`, () => {
	it(`keys messenger origins by chat id and scrapes by label`, () => {
		expect(sourceOriginKey({ type: `telegram`, label: `Berlin`, chatId: `-1001` })).toBe(`telegram:-1001`);
		expect(sourceOriginKey({ type: `scrape`, label: `tribehaus`, url: `https://x` })).toBe(`scrape:tribehaus`);
		expect(sourceOriginKey({ type: `website-form`, label: `website-form` })).toBe(`website-form`);
	});

	it(`merges origins and lets later labels/urls win`, () => {
		const merged = mergeSourceOrigins(
			[{ type: `scrape`, label: `tribehaus`, url: `https://old` }],
			[
				{ type: `scrape`, label: `tribehaus`, url: `https://new` },
				{ type: `telegram`, label: `Room`, chatId: `room1` },
			],
		);

		expect(merged).toEqual([
			{ type: `scrape`, label: `tribehaus`, chatId: null, url: `https://new` },
			{ type: `telegram`, label: `Room`, chatId: `room1`, url: null },
		]);
	});

	it(`derives scrape origins from classic source fields`, () => {
		expect(
			ensureSourceOrigins({
				source: `heilnetz`,
				sourceUrl: `https://heilnetz.de/e`,
			}),
		).toEqual([{ type: `scrape`, label: `heilnetz`, chatId: null, url: `https://heilnetz.de/e` }]);
	});

	it(`keeps messenger provenance only from explicit sourceOrigins`, () => {
		expect(
			ensureSourceOrigins({
				source: `telegram`,
				sourceUrl: `https://example.com`,
				sourceOrigins: [{ type: `telegram`, label: `Berlin`, chatId: `-1001` }],
			}),
		).toEqual([{ type: `telegram`, label: `Berlin`, chatId: `-1001`, url: null }]);

		expect(
			ensureSourceOrigins({
				source: `telegram`,
				sourceUrl: `https://example.com`,
			}),
		).toEqual([]);
	});

	it(`builds named messenger origins`, () => {
		expect(
			messengerSourceOrigin({
				type: `whatsapp`,
				chatId: `120363@g.us`,
				label: `Bali Events`,
				url: `https://example.com`,
			}),
		).toEqual({
			type: `whatsapp`,
			label: `Bali Events`,
			chatId: `120363@g.us`,
			url: `https://example.com`,
		});
	});
});
