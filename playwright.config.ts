import { defineConfig, devices } from '@playwright/test';

/** Dedicated port so we never reuse a normal `vite dev` on 5173 without E2E_TEST (seed API would 403). */
const e2eDevPort = Number(process.env.PLAYWRIGHT_DEV_PORT) || 5174;
const e2eBaseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2eDevPort}`;

/**
 * Playwright configuration for Blissbase E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
	testDir: './tests/e2e',

	/* Run tests in files in parallel */
	fullyParallel: true,

	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: !!process.env.CI,

	/* CI: flakes from infra; local: first test can hit Vite cold start / dep optimize before SSR is stable */
	retries: process.env.CI ? 2 : 1,

	/* One worker: shared Vite dev server + PGlite; parallel runs trigger HMR/full reloads and flake modal/state tests. */
	workers: 1,

	/* Reporter to use */
	reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],

	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: e2eBaseUrl,

		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry',

		/* Screenshot on failure */
		screenshot: 'only-on-failure',

		/* Video recording for debugging */
		video: process.env.CI ? 'retain-on-failure' : 'off',
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	/* Run local dev server before starting the tests */
	webServer: {
		command: `bun run dev -- --port ${e2eDevPort}`,
		url: e2eBaseUrl,
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			E2E_TEST: 'true',
			GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || 'test-api-key',
			PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || 'http://localhost:54321',
			PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'test-key',
			PUBLIC_ADMIN_USER_ID: process.env.PUBLIC_ADMIN_USER_ID || 'test-admin',
			TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'test-token',
			S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'test-s3-key',
			S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'test-s3-secret',
			S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || 'test-bucket',
			CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'test-account',
			ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'test@admin.de',
		},
	},
	expect: {
		timeout: 10000,
	},
});
