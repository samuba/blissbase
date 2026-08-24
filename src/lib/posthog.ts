import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js";
import { browser, dev } from "$app/environment";

/** Browser/extension injections that look like app errors (Firefox iOS, Chrome iOS, wallets). */
const BROWSER_NOISE_SUBSTRINGS = [
	`__firefox__`,
	`__gCrWeb`,
	`window.ethereum`,
] as const;

export function isBrowserNoiseExceptionMessage(message: string | undefined) {
	if (!message) return false;
	return BROWSER_NOISE_SUBSTRINGS.some((noise) => message.includes(noise));
}

export function isBrowserNoiseException(error: unknown) {
	if (!(error instanceof Error)) return false;
	return isBrowserNoiseExceptionMessage(error.message);
}

/** Drop `$exception` events from browser-injected scripts before they hit PostHog. */
export function filterPosthogBrowserNoise(event: CaptureResult | null): CaptureResult | null {
	if (!event || event.event !== `$exception`) return event;

	const values = event.properties?.[`$exception_values`];
	if (Array.isArray(values) && values.some((value) => isBrowserNoiseExceptionMessage(String(value)))) {
		return null;
	}

	const list = event.properties?.[`$exception_list`];
	if (Array.isArray(list) && list.some((item) => isBrowserNoiseExceptionMessage(String(item?.value)))) {
		return null;
	}

	return event;
}

/** Shared by the browser `identify` call and the server-side `$set` so both stay in sync. */
export function buildPosthogPersonProperties(args: {
	email: string | undefined;
	displayName: string | undefined;
	isAdminSession: boolean;
}) {
	const email = args.email?.trim();
	const name = args.displayName?.trim();
	return {
		...(email ? { email } : {}),
		...(name ? { name } : {}),
		...(args.isAdminSession ? { is_admin: true } : {}),
	};
}

export function syncPosthogIdentity(args: {
	userId: string | undefined;
	email: string | undefined;
	displayName: string | undefined;
	isAdminSession: boolean;
}) {
	if (!browser || dev) return;
	if (!args.userId) {
		resetPosthogIdentity();
		return;
	}

	// posthog-js ignores repeated identify calls with unchanged properties
	posthog.identify(args.userId, buildPosthogPersonProperties(args));
}

export function resetPosthogIdentity() {
	if (!browser || dev) return;
	// Anonymous visitors must keep their distinct id, otherwise every navigation starts a new person
	if (!posthog._isIdentified()) return;
	posthog.reset();
}
