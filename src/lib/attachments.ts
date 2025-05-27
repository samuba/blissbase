import type { Attachment, Element } from "svelte/attachments";

/**
 * Attaches a click handler to an element, optimized for touch devices.
 * On touch devices, it distinguishes between taps and drags/scrolls by monitoring pointer events.
 * On non-touch devices, it uses a standard 'click' event.
 *
 * This function is a Svelte attachment factory. Use it like: `<div use:onPointerClick={handler}></div>`.
 *
 * @param handler - The function to call when a click/tap is detected.
 *                  Receives the PointerEvent (for touch, specifically the initial pointerdown event) or MouseEvent (for non-touch).
 * @returns A Svelte attachment function that, when applied to an element, attaches the event listeners
 *          and returns an object with a `destroy` method to clean them up.
 */
export function onPointerClick(handler: (event: PointerEvent | MouseEvent) => void): Attachment {
    // Determined once when the attachment factory is called.
    const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

    // This is the Svelte attachment function.
    return (element) => {
        if (!(element instanceof HTMLElement)) {
            throw new Error('Element must be an HTMLElement');
        }
        const MAX_CLICK_DURATION_MS = 300;
        const MAX_CLICK_MOVEMENT_PX = 10; // pixels

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let pointerId: number | null = null;
        let initialPointerDownEvent: PointerEvent | null = null;

        const handlePointerDown = (event: PointerEvent) => {
            if (!event.isPrimary || pointerId !== null) {
                return; // Only process primary pointer and if not already tracking one
            }

            pointerId = event.pointerId;
            initialPointerDownEvent = event; // Store the initial event
            startX = event.clientX;
            startY = event.clientY;
            startTime = Date.now();

            try {
                element.setPointerCapture(pointerId);
            } catch {
                // console.warn('Failed to set pointer capture:');
            }

            element.addEventListener('pointermove', handlePointerMove);
            element.addEventListener('pointerup', handlePointerUp);
            element.addEventListener('pointercancel', handlePointerCancel);
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }
            // Logic to determine if it's a drag can be added here for early exit,
            // but for simplicity, all checks are currently in handlePointerUp.
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }

            // Store the initial event before resetting state
            const downEvent = initialPointerDownEvent;

            // Cleanup listeners and pointer capture
            element.removeEventListener('pointermove', handlePointerMove);
            element.removeEventListener('pointerup', handlePointerUp);
            element.removeEventListener('pointercancel', handlePointerCancel);
            if (pointerId !== null) {
                try {
                    if (element.hasPointerCapture(pointerId)) {
                        element.releasePointerCapture(pointerId);
                    }
                } catch { /* Squelch */ }
            }

            pointerId = null;
            initialPointerDownEvent = null;

            const endTime = Date.now();
            const duration = endTime - startTime;
            const deltaX = Math.abs(event.clientX - startX);
            const deltaY = Math.abs(event.clientY - startY);

            if (
                duration < MAX_CLICK_DURATION_MS &&
                deltaX < MAX_CLICK_MOVEMENT_PX &&
                deltaY < MAX_CLICK_MOVEMENT_PX
            ) {
                if (downEvent) { // Check if downEvent is not null
                    handler(downEvent); // Execute handler with the initial pointerdown event
                }
            }
        };

        const handlePointerCancel = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }

            // Cleanup listeners and pointer capture
            element.removeEventListener('pointermove', handlePointerMove);
            element.removeEventListener('pointerup', handlePointerUp);
            element.removeEventListener('pointercancel', handlePointerCancel);
            if (pointerId !== null) {
                try {
                    if (element.hasPointerCapture(pointerId)) {
                        element.releasePointerCapture(pointerId);
                    }
                } catch { /* Squelch */ }
            }

            pointerId = null;
            initialPointerDownEvent = null;
        };

        if (isTouchDevice) {
            element.addEventListener('pointerdown', handlePointerDown);
        } else {
            element.addEventListener('click', handler);
        }

        return () => {
            if (isTouchDevice) {
                element.removeEventListener('pointerdown', handlePointerDown);
                // Ensure any dynamically added listeners are also removed if interaction was in progress
                element.removeEventListener('pointermove', handlePointerMove);
                element.removeEventListener('pointerup', handlePointerUp);
                element.removeEventListener('pointercancel', handlePointerCancel);
                if (pointerId !== null) { // If a pointer was active
                    try {
                        if (element.hasPointerCapture(pointerId)) {
                            element.releasePointerCapture(pointerId);
                        }
                    } catch { /* Squelch */ }
                    pointerId = null; // Reset state
                    initialPointerDownEvent = null;
                }
            } else {
                element.removeEventListener('click', handler);
            }
        };
    };
}