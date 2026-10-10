import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillMissingEventAttributes } from './fillScrapedEventAttributes.ts';

describe(`fillMissingEventAttributes`, () => {
	const logSpy = vi.spyOn(console, `log`).mockImplementation(() => {});

	afterEach(() => {
		logSpy.mockClear();
	});

	it(`skips events that already have tag slugs`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [`yoga`],
			language: `german` as const,
			structure: `session` as const,
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
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
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 0, skipped: 1, failed: 0 });
		expect(judgeEventAttributes).not.toHaveBeenCalled();
		expect(updateEventAttributes).not.toHaveBeenCalled();
	});

	it(`skips unlisted events`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({ tags: [], isConscious: false }));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [{ id: 14, name: `Generic Gym`, tagSlugs: [], listed: false }],
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 0, skipped: 1, failed: 0 });
		expect(judgeEventAttributes).not.toHaveBeenCalled();
	});

	it(`writes tags, language, structure for conscious events`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [`meditation`],
			language: `german` as const,
			structure: `session` as const,
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
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
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 1, skipped: 0, failed: 0 });
		expect(judgeEventAttributes).toHaveBeenCalledWith({
			name: `Morning Sit`,
			description: `<p>Silent meditation</p>`,
		});
		expect(updateEventAttributes).toHaveBeenCalledWith({
			ids: [2],
			tagSlugs: [`meditation`],
			language: `german`,
			structure: `session`,
			listed: undefined,
		});
	});

	it(`unlists non-conscious events even without tags`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [],
			isConscious: false,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 3,
					name: `Generic Gym`,
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 1, skipped: 0, failed: 0 });
		expect(updateEventAttributes).toHaveBeenCalledWith({
			ids: [3],
			tagSlugs: [],
			language: undefined,
			structure: undefined,
			listed: false,
		});
	});

	it(`does not write when conscious with no tags, language, or structure`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [],
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 4,
					name: `Mystery Gathering`,
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 0, skipped: 0, failed: 0 });
		expect(updateEventAttributes).not.toHaveBeenCalled();
	});

	it(`retries a thrown judge call with exponential backoff, then swallows and continues`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {});
		const sleep = vi.fn(async () => {});
		const judgeEventAttributes = vi.fn(async ({ name }: { name: string }) => {
			if (name === `Broken Event`) throw new Error(`ai down`);
			return {
				tags: [`ecstatic-dance`],
				language: `english` as const,
				structure: `session` as const,
				isConscious: true,
			};
		});
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 5,
					name: `Broken Event`,
					source: `seijetzt`,
					tagSlugs: [],
				},
				{
					id: 6,
					name: `Dance Night`,
					source: `seijetzt`,
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
			sleep,
			concurrency: 1,
		});

		expect(result).toEqual({ filled: 1, skipped: 0, failed: 1 });
		expect(judgeEventAttributes).toHaveBeenCalledTimes(7);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 10_000]);
		expect(updateEventAttributes).toHaveBeenCalledTimes(1);
		expect(updateEventAttributes).toHaveBeenCalledWith({
			ids: [6],
			tagSlugs: [`ecstatic-dance`],
			language: `english`,
			structure: `session`,
			listed: undefined,
		});
		expect(errorSpy).toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledTimes(5);
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it(`uses a later judge retry when earlier attempts throw`, async () => {
		const sleep = vi.fn(async () => {});
		let attempts = 0;
		const judgeEventAttributes = vi.fn(async () => {
			attempts += 1;
			if (attempts < 3) throw new Error(`ai down`);
			return {
				tags: [`yoga`],
				language: `german` as const,
				structure: `course` as const,
				isConscious: true,
			};
		});
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 12,
					name: `Flaky Yoga`,
					source: `tribehaus`,
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
			sleep,
		});

		expect(result).toEqual({ filled: 1, skipped: 0, failed: 0 });
		expect(judgeEventAttributes).toHaveBeenCalledTimes(3);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
		expect(updateEventAttributes).toHaveBeenCalledWith({
			ids: [12],
			tagSlugs: [`yoga`],
			language: `german`,
			structure: `course`,
			listed: undefined,
		});
	});

	it(`swallows update failures without stopping later events`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [`yoga`],
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async ({ ids }: { ids: number[] }) => {
			if (ids[0] === 7) throw new Error(`db down`);
		});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 7,
					name: `Yoga One`,
					source: `tribehaus`,
					tagSlugs: [],
				},
				{
					id: 8,
					name: `Yoga Two`,
					source: `tribehaus`,
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
			concurrency: 1,
		});

		expect(result).toEqual({ filled: 1, skipped: 0, failed: 1 });
		expect(updateEventAttributes).toHaveBeenCalledTimes(2);
		errorSpy.mockRestore();
	});

	it(`judges series events that share name, host, source, and address with one call`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [`contact-improvisation`],
			language: `german` as const,
			structure: `session` as const,
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 9,
					name: `CI Jam`,
					description: `short`,
					host: `Contact Osna`,
					source: `ciglobalcalendar`,
					address: [`Osnabrück`],
					tagSlugs: [],
				},
				{
					id: 10,
					name: `CI Jam`,
					description: `A longer weekly contact improvisation jam description`,
					host: `Contact Osna`,
					source: `ciglobalcalendar`,
					address: [`Osnabrück`],
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 2, skipped: 0, failed: 0 });
		expect(judgeEventAttributes).toHaveBeenCalledTimes(1);
		expect(judgeEventAttributes).toHaveBeenCalledWith({
			name: `CI Jam`,
			description: `A longer weekly contact improvisation jam description`,
		});
		expect(updateEventAttributes).toHaveBeenCalledWith({
			ids: [9, 10],
			tagSlugs: [`contact-improvisation`],
			language: `german`,
			structure: `session`,
			listed: undefined,
		});
	});

	it(`does not share a judge call when the address differs`, async () => {
		const judgeEventAttributes = vi.fn(async () => ({
			tags: [`yoga`],
			isConscious: true,
		}));
		const updateEventAttributes = vi.fn(async () => {});

		const result = await fillMissingEventAttributes({
			events: [
				{
					id: 11,
					name: `Yoga`,
					host: `Studio`,
					source: `tribehaus`,
					address: [`Berlin`],
					tagSlugs: [],
				},
				{
					id: 13,
					name: `Yoga`,
					host: `Studio`,
					source: `tribehaus`,
					address: [`Hamburg`],
					tagSlugs: [],
				},
			],
			judgeEventAttributes,
			updateEventAttributes,
		});

		expect(result).toEqual({ filled: 2, skipped: 0, failed: 0 });
		expect(judgeEventAttributes).toHaveBeenCalledTimes(2);
		expect(updateEventAttributes).toHaveBeenCalledTimes(2);
	});
});
