import type { CaptureResult, PostHog } from "posthog-js";
import { browser, dev } from "$app/env";

let posthogPromise: Promise<PostHog> | undefined;

/** posthog-js is ~70 kB gzip — load it after the page is idle instead of on the hydration path. */
export function loadPosthog() {
	posthogPromise ??= whenIdle().then(async () => {
		const { default: posthog } = await import(`posthog-js`);
		if (!dev && !location.host.endsWith(`.vercel.app`)) {
			posthog.init(`phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ`, {
				api_host: `https://igel.blissbase.app`,
				defaults: `2025-05-24`,
				person_profiles: `always`,
				before_send: filterPosthogBrowserNoise,
			});
		}
		return posthog;
	});
	return posthogPromise;
}

function whenIdle() {
	return new Promise<void>((resolve) => {
		if (`requestIdleCallback` in window) {
			requestIdleCallback(() => resolve(), { timeout: 3000 });
			return;
		}
		setTimeout(resolve, 1500);
	});
}

/** Browser/extension injections that look like app errors (Firefox iOS, Chrome iOS, wallets). */
const BROWSER_NOISE_SUBSTRINGS = [`__firefox__`, `__gCrWeb`, `window.ethereum`] as const;

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

	const userId = args.userId;
	// posthog-js ignores repeated identify calls with unchanged properties
	void loadPosthog().then((posthog) => posthog.identify(userId, buildPosthogPersonProperties(args)));
}

export function resetPosthogIdentity() {
	if (!browser || dev) return;
	void loadPosthog().then((posthog) => {
		// Anonymous visitors must keep their distinct id, otherwise every navigation starts a new person
		if (!posthog._isIdentified()) return;
		posthog.reset();
	});
}
