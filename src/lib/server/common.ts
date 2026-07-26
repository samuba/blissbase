import { getRequestEvent } from "$app/server";
import { error } from "@sveltejs/kit";
import { buildPosthogPersonProperties } from "$lib/posthog";

export function locals(): App.Locals {
	return getRequestEvent().locals;
}

/**
 * Returns the authenticated user id or throws a 401 response.
 * Pass `locals` when you already have it (e.g. to read other fields from the same request).
 * @example
 * const userId = ensureUserId();
 * const userId = ensureUserId({ message: `You must be signed in to create an event` });
 * const userId = ensureUserId({ locals, message: `You must be signed in to create an event` });
 */
export function ensureUserId(args?: { locals?: App.Locals; msg?: string }) {
	const userId = args?.locals?.userId ?? locals()?.userId;
	if (!userId) {
		error(401, args?.msg ?? `Unauthorized`);
	}
	return userId;
}

export function posthog() {
	return locals().posthog;
}

/** Falls back to the anonymous id from the posthog cookie so signed-out traffic stays attributable. */
export function posthogDistinctId(args?: { locals?: App.Locals }) {
	const { userId, posthogDistinctId: cookieDistinctId } = args?.locals ?? locals();
	return userId ?? cookieDistinctId;
}

function getPosthogPersonProperties() {
	const { jwtClaims, isAdminSession } = locals();
	return buildPosthogPersonProperties({
		email: jwtClaims?.email,
		displayName: jwtClaims?.user_metadata?.display_name,
		isAdminSession,
	});
}

export function posthogCaptureException(error: Error) {
	const { posthog, userId } = locals();
	console.error(error, { userId });
	posthog.captureException(error, posthogDistinctId());
}

export function posthogCapture(event: string, properties: Record<string, unknown>) {
	const distinctId = posthogDistinctId();
	if (!distinctId) return;

	const personProperties = getPosthogPersonProperties();
	posthog().captureImmediate({
		event,
		distinctId,
		properties: {
			...properties,
			...(Object.keys(personProperties).length ? { $set: personProperties } : {}),
		},
	});
}
