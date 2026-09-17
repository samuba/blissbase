import type { Page } from "@playwright/test";

/**
 * Vite's first SSR of a route can return 500 while deps compile.
 * Retry those navigations so tests don't click around on the error page.
 */
export function installGotoRetries(page: Page) {
	const originalGoto = page.goto.bind(page);
	page.goto = async (url, options) => {
		let lastResponse: Awaited<ReturnType<typeof originalGoto>> = null;
		for (let attempt = 0; attempt < 8; attempt++) {
			try {
				lastResponse = await originalGoto(url, options);
			} catch (error) {
				if (attempt === 7) throw error;
				await wait(200 * (attempt + 1));
				continue;
			}

			const status = lastResponse?.status() ?? 0;
			if (status > 0 && status < 500) return lastResponse;
			if (attempt === 7) return lastResponse;
			await wait(200 * (attempt + 1));
		}
		return lastResponse;
	};
}

function wait(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
