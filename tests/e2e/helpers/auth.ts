import type { Page } from '@playwright/test';
import { e2eCookieDomain } from './origin';

/**
 * Sets E2E auth cookies consumed by hooks.server.ts.
 *
 * @example
 * await signInAsE2EUser(page);
 */
export async function signInAsE2EUser(page: Page, args: SignInAsE2EUserArgs = {}) {
	const domain = e2eCookieDomain();

	await page.context().addCookies([
		{
			name: `e2e_user_id`,
			value: args.userId ?? `00000000-0000-4000-8000-000000000001`,
			domain,
			path: `/`,
		},
		{
			name: `e2e_user_email`,
			value: args.email ?? `e2e-user@example.com`,
			domain,
			path: `/`,
		}
	]);
}

type SignInAsE2EUserArgs = {
	userId?: string;
	email?: string;
};
