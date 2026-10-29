import { PostHog } from 'posthog-node';

export const posthogApiKey = `phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ`;

/** Disabled in dev (local `vite dev` and Playwright E2E) so test traffic never reaches the production project. */
export function createServerPosthog(args: { dev: boolean }) {
	return new PostHog(posthogApiKey, { host: `https://eu.i.posthog.com`, disabled: args.dev });
}
