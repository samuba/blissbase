import type { HandleClientError } from "@sveltejs/kit/hooks";
import { dev } from "$app/env";
import { isBrowserNoiseException, loadPosthog } from "#lib/posthog.ts";

export const handleError: HandleClientError = async ({ kind, error }) => {
	// Kit 3 routes expected app/framework errors through handleError — only report unknowns.
	if (kind !== `unknown`) return;
	if (isBrowserNoiseException(error)) return;

	console.error(error);
	if (!dev) {
		void loadPosthog().then((posthog) => posthog.captureException(error));
	}
};
