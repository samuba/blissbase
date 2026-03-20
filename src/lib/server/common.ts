import { getRequestEvent } from "$app/server";
import { error } from "@sveltejs/kit";

export function locals(): App.Locals {
    return getRequestEvent().locals
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
    return locals().posthog
}

export function posthogCaptureException(error: Error) {
    const { posthog, userId } = locals()
    console.error(error, { userId, error});
    posthog.captureException(error, userId);
}

export function posthogCapture(event: string, properties: Record<string, unknown>) {
    const { posthog, userId } = locals()
    if (userId) {
        posthog.captureImmediate({
            event,
            distinctId: userId,
            properties
        })
    }
}