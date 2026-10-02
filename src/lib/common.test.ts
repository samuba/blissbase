import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff, runWithConcurrency } from "$lib/common";

describe(`retryWithBackoff`, () => {
	it(`returns the first successful result`, async () => {
		const run = vi.fn().mockRejectedValueOnce(new Error(`network`)).mockResolvedValueOnce(`ok`);
		await expect(retryWithBackoff({ attempts: 3, baseDelayMs: 0, run })).resolves.toBe(`ok`);
		expect(run).toHaveBeenCalledTimes(2);
		expect(run).toHaveBeenLastCalledWith(2);
	});

	it(`rethrows the last error after the last attempt`, async () => {
		const run = vi.fn().mockRejectedValue(new Error(`network`));
		await expect(retryWithBackoff({ attempts: 3, baseDelayMs: 0, run })).rejects.toThrow(`network`);
		expect(run).toHaveBeenCalledTimes(3);
	});

	it(`stops when shouldRetry returns false`, async () => {
		const run = vi.fn().mockRejectedValue(new Error(`network`));
		await expect(retryWithBackoff({ attempts: 3, baseDelayMs: 0, run, shouldRetry: () => false })).rejects.toThrow();
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe(`runWithConcurrency`, () => {
	it(`runs every item and never more than the limit at once`, async () => {
		let active = 0;
		let maxActive = 0;
		const done: number[] = [];
		await runWithConcurrency({
			items: [1, 2, 3, 4, 5],
			limit: 2,
			run: async (item) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active--;
				done.push(item);
			},
		});
		expect(maxActive).toBe(2);
		expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it(`continues with the next items when one item rejects`, async () => {
		const done: number[] = [];
		vi.spyOn(console, `error`).mockImplementation(() => {});
		await runWithConcurrency({
			items: [1, 2, 3],
			limit: 1,
			run: async (item) => {
				if (item === 1) throw new Error(`boom`);
				done.push(item);
			},
		});
		expect(done).toEqual([2, 3]);
	});
});
