import type { Page } from '@playwright/test';

/**
 * Sets E2E auth cookies consumed by hooks.server.ts.
 *
 * @example
 * await signInAsE2EUser(page);
 */
function e2ePlaywrightOrigin() {
	const port = process.env.PLAYWRIGHT_DEV_PORT || `5174`;
	return process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`;
}

export async function signInAsE2EUser(page: Page, args: SignInAsE2EUserArgs = {}) {
	const url = new URL(e2ePlaywrightOrigin());

	await page.context().addCookies([
		{
			name: `e2e_user_id`,
			value: args.userId ?? `00000000-0000-4000-8000-000000000001`,
			domain: url.hostname,
			path: `/`
		},
		{
			name: `e2e_user_email`,
			value: args.email ?? `e2e-user@example.com`,
			domain: url.hostname,
			path: `/`
		}
	]);
}

type SignInAsE2EUserArgs = {
	userId?: string;
	email?: string;
};
