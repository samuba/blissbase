import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Blissbase E2E tests
 * @see https://playwright.dev/docs/test-configuration
 *
 * Each worker starts its own Vite + PGlite server (see tests/e2e/helpers/fixtures.ts)
 * so DB, auth cookies, storage, and ports stay isolated. Do not add a shared webServer.
 */
export default defineConfig({
	testDir: './tests/e2e',
	testIgnore: ['**/helpers/**'],

	/* Run tests in files in parallel across isolated workers */
	fullyParallel: true,

	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: !!process.env.CI,

	/* CI: flakes from infra; local: first test can hit Vite cold start / dep optimize before SSR is stable */
	retries: process.env.CI ? 4 : 2,

	/* Isolated Vite+PGlite per worker. Override with PLAYWRIGHT_WORKERS. */
	workers: process.env.PLAYWRIGHT_WORKERS
		? Number(process.env.PLAYWRIGHT_WORKERS)
		: process.env.CI
			? 2
			: 3,

	/* Reporter to use */
	reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],

	/* Shared settings for all the projects below */
	use: {
		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry',

		/* Screenshot on failure */
		screenshot: 'only-on-failure',

		/* Video recording for debugging */
		video: process.env.CI ? 'retain-on-failure' : 'off',

		/* Fresh cookies/localStorage per test (Playwright default); never share storageState. */
		storageState: { cookies: [], origins: [] },

		/* Create-flow specs assert German copy; hooks.server.ts also honors Accept-Language=de. */
		locale: 'de-DE',
		extraHTTPHeaders: {
			'Accept-Language': 'de',
		},
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	expect: {
		timeout: 10000,
	},
});
