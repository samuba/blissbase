import posthog from "posthog-js";
import { browser, dev } from "$app/environment";

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
