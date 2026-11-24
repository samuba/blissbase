import { describe, expect, it } from "vitest";
import { planStaleSourceCleanup } from "./staleSourceCleanup";

describe(`planStaleSourceCleanup`, () => {
	it(`deletes when the stale scrape is the only non-messenger origin (messenger does not protect)`, () => {
		const plan = planStaleSourceCleanup({
			event: {
				source: `tribehaus`,
				sourceUrl: `https://tribehaus.app/e`,
				sourceOrigins: [
					{ type: `scrape`, label: `tribehaus`, url: `https://tribehaus.app/e` },
					{ type: `telegram`, label: `Berlin`, chatId: `-1001` },
				],
			},
			staleSources: [`tribehaus`],
		});

		expect(plan).toEqual({ action: `delete` });
	});

	it(`strips the stale scrape when another website origin remains`, () => {
		const plan = planStaleSourceCleanup({
			event: {
				source: `tribehaus`,
				sourceUrl: `https://tribehaus.app/e`,
				sourceOrigins: [
					{ type: `scrape`, label: `tribehaus`, url: `https://tribehaus.app/e` },
					{ type: `scrape`, label: `heilnetz`, url: `https://heilnetz.de/e` },
				],
			},
			staleSources: [`tribehaus`],
		});

		expect(plan).toEqual({
			action: `update`,
			source: `heilnetz`,
			sourceUrl: `https://heilnetz.de/e`,
			sourceOrigins: [{ type: `scrape`, label: `heilnetz`, chatId: null, url: `https://heilnetz.de/e` }],
		});
	});

	it(`noops when the event is not tied to the stale sources`, () => {
		const plan = planStaleSourceCleanup({
			event: {
				source: `telegram`,
				sourceChatIdsTelegram: [`room1`],
				sourceOrigins: [{ type: `telegram`, label: `Room`, chatId: `room1` }],
			},
			staleSources: [`tribehaus`],
		});

		expect(plan).toEqual({ action: `noop` });
	});

	it(`derives origins from classic source when sourceOrigins is empty`, () => {
		const plan = planStaleSourceCleanup({
			event: {
				source: `meetup`,
				sourceUrl: `https://meetup.com/e`,
				sourceOrigins: [],
			},
			staleSources: [`meetup`],
		});

		expect(plan).toEqual({ action: `delete` });
	});
});
