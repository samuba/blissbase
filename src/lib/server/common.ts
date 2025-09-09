import { getRequestEvent } from "$app/server";

export function locals(): App.Locals {
    return getRequestEvent().locals
}

export function posthog() {
    return locals().posthog
}

export function posthogCapture(event: string, properties: Record<string, any>) {
    const { posthog, user } = locals()
    if (user?.id) {
        posthog.captureImmediate({
            event,
            distinctId: user?.id,
            properties
        })
    } else {
        console.warn(`No posthog distinct id or user id found for event: ${event}`, properties)
    }
}