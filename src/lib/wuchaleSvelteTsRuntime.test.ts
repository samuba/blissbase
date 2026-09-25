import { readFileSync } from "node:fs";
import { adapter as svelte } from "@wuchale/svelte";
import { IndexTracker } from "wuchale";
import { describe, expect, it } from "vitest";
import { svelteTsModuleRuntime } from "../../wuchale.svelte-runtime.js";

const svelteAdapter = svelte({
	loader: `sveltekit`,
	runtime: svelteTsModuleRuntime,
});

describe(`wuchale svelte.ts runtime`, () => {
	it(`leaves _w_runtime_ undeclared in .svelte.ts without the override`, async () => {
		const defaultAdapter = svelte({ loader: `sveltekit` });
		const { code } = await transformWith(defaultAdapter, `src/lib/flashToast.svelte.ts`);
		expect(code).toMatch(/_w_runtime_\(/);
		expect(code).not.toContain(`const _w_runtime_`);
	});

	it(`declares _w_runtime_ in toast modules so compiled calls do not throw`, async () => {
		for (const filename of [
			`src/lib/flashToast.svelte.ts`,
			`src/lib/authCallbackFeedbackToast.svelte.ts`,
			`src/lib/createFlowAuth.svelte.ts`,
		]) {
			const { code } = await transformSvelteTs(filename);
			expect(code, filename).toContain(`const _w_runtime_`);
			expect(code, filename).toMatch(/_w_runtime_\(/);
		}
	});
});

async function transformSvelteTs(filename: string) {
	return transformWith(svelteAdapter, filename);
}

async function transformWith(adapter: ReturnType<typeof svelte>, filename: string) {
	const content = readFileSync(filename, `utf8`);
	const result = await adapter.transform({
		content,
		filename,
		index: new IndexTracker(true),
		expr: { reactive: `_w_load_rx_()`, plain: `_w_load_()` },
		matchUrl: () => null,
	});
	return result.output(``);
}
