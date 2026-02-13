import { defineConfig, devices } from '@playwright/test';

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

	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,

	/* Opt out of parallel tests on CI */
	workers: process.env.CI ? 1 : undefined,

	/* Reporter to use */
	reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],

	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',

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
		command: 'bun run dev',
		url: 'http://localhost:5173',
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
			ADMIN_SECRET: process.env.ADMIN_SECRET || 'test-admin-secret',
		},
	},
	expect: {
		timeout: 10000,
	},
});
