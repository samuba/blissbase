import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillMissingEventTagSlugs } from './tagScrapedEvents.ts';

describe(`fillMissingEventTagSlugs`, () => {
	const logSpy = vi.spyOn(console, `log`).mockImplementation(() => {});

	afterEach(() => {
		logSpy.mockClear();
	});

	it(`skips events that already have tag slugs`, async () => {
		const suggestTagSlugs = vi.fn(async () => [`yoga`]);
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 1,
					name: `Already Tagged Yoga`,
					description: `A yoga class`,
					host: `Studio`,
					source: `tribehaus`,
					tagSlugs: [`yoga`],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
		});

		expect(result).toEqual({ tagged: 0, skipped: 1, failed: 0 });
		expect(suggestTagSlugs).not.toHaveBeenCalled();
		expect(updateTagSlugs).not.toHaveBeenCalled();
	});

	it(`tags untagged events and writes known slugs`, async () => {
		const suggestTagSlugs = vi.fn(async () => [`meditation`]);
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 2,
					name: `Morning Sit`,
					description: `<p>Silent meditation</p>`,
					host: `Temple`,
					source: `heilnetz`,
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
		});

		expect(result).toEqual({ tagged: 1, skipped: 0, failed: 0 });
		expect(suggestTagSlugs).toHaveBeenCalledWith({
			name: `Morning Sit`,
			description: `<p>Silent meditation</p>`,
		});
		expect(updateTagSlugs).toHaveBeenCalledWith({
			ids: [2],
			tagSlugs: [`meditation`],
		});
	});

	it(`does not write when the AI returns no slugs`, async () => {
		const suggestTagSlugs = vi.fn(async () => []);
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 3,
					name: `Mystery Gathering`,
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
		});

		expect(result).toEqual({ tagged: 0, skipped: 0, failed: 0 });
		expect(updateTagSlugs).not.toHaveBeenCalled();
	});

	it(`retries a thrown AI call with exponential backoff, then swallows and continues`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {});
		const sleep = vi.fn(async () => {});
		const suggestTagSlugs = vi.fn(async ({ name }: { name: string }) => {
			if (name === `Broken Event`) throw new Error(`ai down`);
			return [`ecstatic-dance`];
		});
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 4,
					name: `Broken Event`,
					source: `seijetzt`,
					tagSlugs: [],
				},
				{
					id: 5,
					name: `Dance Night`,
					source: `seijetzt`,
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
			sleep,
			concurrency: 1,
		});

		expect(result).toEqual({ tagged: 1, skipped: 0, failed: 1 });
		expect(suggestTagSlugs).toHaveBeenCalledTimes(7);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 10_000]);
		expect(updateTagSlugs).toHaveBeenCalledTimes(1);
		expect(updateTagSlugs).toHaveBeenCalledWith({
			ids: [5],
			tagSlugs: [`ecstatic-dance`],
		});
		expect(errorSpy).toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledTimes(5);
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it(`uses a later AI retry when earlier attempts throw`, async () => {
		const sleep = vi.fn(async () => {});
		let attempts = 0;
		const suggestTagSlugs = vi.fn(async () => {
			attempts += 1;
			if (attempts < 3) throw new Error(`ai down`);
			return [`yoga`];
		});
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 12,
					name: `Flaky Yoga`,
					source: `tribehaus`,
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
			sleep,
		});

		expect(result).toEqual({ tagged: 1, skipped: 0, failed: 0 });
		expect(suggestTagSlugs).toHaveBeenCalledTimes(3);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
		expect(updateTagSlugs).toHaveBeenCalledWith({
			ids: [12],
			tagSlugs: [`yoga`],
		});
	});

	it(`swallows update failures without stopping later events`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const suggestTagSlugs = vi.fn(async () => [`yoga`]);
		const updateTagSlugs = vi.fn(async ({ ids }: { ids: number[] }) => {
			if (ids[0] === 6) throw new Error(`db down`);
		});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 6,
					name: `Yoga One`,
					source: `tribehaus`,
					tagSlugs: [],
				},
				{
					id: 7,
					name: `Yoga Two`,
					source: `tribehaus`,
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
			concurrency: 1,
		});

		expect(result).toEqual({ tagged: 1, skipped: 0, failed: 1 });
		expect(updateTagSlugs).toHaveBeenCalledTimes(2);
		errorSpy.mockRestore();
	});

	it(`tags series events that share name, host, source, and address with one AI call`, async () => {
		const suggestTagSlugs = vi.fn(async () => [`contact-improvisation`]);
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 8,
					name: `CI Jam`,
					description: `short`,
					host: `Contact Osna`,
					source: `ciglobalcalendar`,
					address: [`Osnabrück`],
					tagSlugs: [],
				},
				{
					id: 9,
					name: `CI Jam`,
					description: `A longer weekly contact improvisation jam description`,
					host: `Contact Osna`,
					source: `ciglobalcalendar`,
					address: [`Osnabrück`],
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
		});

		expect(result).toEqual({ tagged: 2, skipped: 0, failed: 0 });
		expect(suggestTagSlugs).toHaveBeenCalledTimes(1);
		expect(suggestTagSlugs).toHaveBeenCalledWith({
			name: `CI Jam`,
			description: `A longer weekly contact improvisation jam description`,
		});
		expect(updateTagSlugs).toHaveBeenCalledWith({
			ids: [8, 9],
			tagSlugs: [`contact-improvisation`],
		});
	});

	it(`does not share an AI call when the address differs`, async () => {
		const suggestTagSlugs = vi.fn(async () => [`yoga`]);
		const updateTagSlugs = vi.fn(async () => {});

		const result = await fillMissingEventTagSlugs({
			events: [
				{
					id: 10,
					name: `Yoga`,
					host: `Studio`,
					source: `tribehaus`,
					address: [`Berlin`],
					tagSlugs: [],
				},
				{
					id: 11,
					name: `Yoga`,
					host: `Studio`,
					source: `tribehaus`,
					address: [`Hamburg`],
					tagSlugs: [],
				},
			],
			suggestTagSlugs,
			updateTagSlugs,
		});

		expect(result).toEqual({ tagged: 2, skipped: 0, failed: 0 });
		expect(suggestTagSlugs).toHaveBeenCalledTimes(2);
		expect(updateTagSlugs).toHaveBeenCalledTimes(2);
	});
});
