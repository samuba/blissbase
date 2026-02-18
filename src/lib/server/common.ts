import { getRequestEvent } from "$app/server";

export function locals(): App.Locals {
    return getRequestEvent().locals
}

export function posthog() {
    return locals().posthog
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