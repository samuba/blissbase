import { getRequestEvent } from "$app/server";

export function locals(): App.Locals {
    return getRequestEvent().locals
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