import type { Attachment } from "svelte/attachments";

/**
 * Attaches a onClick on mouse devices and a pointerdown on touch devices to circumvent the 300ms delay onClick has on touch devices.
 * On touch devices, it distinguishes between taps and drags/scrolls by monitoring pointer events.
 *
 * This function is a Svelte attachment factory. Use it like: `<div {@attach onPointerClick={handler}}></div>`.
 *
 * @param handler - The function to call when a click/tap is detected.
 *                  Receives the PointerEvent (for touch, specifically the initial pointerdown event) or MouseEvent (for non-touch).
 * @param excludeSelector - Optional CSS selector for child elements that should not trigger the handler when clicked.
 * @returns A Svelte attachment function that, when applied to an element, attaches the event listeners
 *          and returns an object with a `destroy` method to clean them up.
 */
export function onTap(
    handler: (event: PointerEvent | MouseEvent) => void,
    excludeSelector?: string
): Attachment {
    // Determined once when the attachment factory is called.
    const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

    // This is the Svelte attachment function.
    return (element) => {
        if (!(element instanceof HTMLElement)) {
            throw new Error('Element must be an HTMLElement');
        }

        /**
         * Checks if the event target matches the excluded selector
         */
        const shouldExclude = (event: PointerEvent | MouseEvent): boolean => {
            if (!excludeSelector || !event.target) {
                return false;
            }

            const target = event.target as Element;

            // Check if the target or any of its ancestors (up to the element) matches the excluded selector
            const excludedElement = target.closest(excludeSelector);

            // Only exclude if the excluded element is within our element boundaries
            return excludedElement !== null && element.contains(excludedElement);
        };

        const MAX_CLICK_DURATION_MS = 300;
        const MAX_CLICK_MOVEMENT_PX = 10; // pixels

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let pointerId: number | null = null;
        let initialPointerDownEvent: PointerEvent | null = null;
        let isDragging = false;

        // Pre-declare event handlers to avoid creating new functions on each interaction
        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId || isDragging) {
                return;
            }

            // Use stopImmediatePropagation to prevent other listeners from being called
            event.stopImmediatePropagation();

            // Early exit optimization: if movement exceeds threshold, mark as dragging
            const deltaX = Math.abs(event.clientX - startX);
            const deltaY = Math.abs(event.clientY - startY);

            if (deltaX > MAX_CLICK_MOVEMENT_PX || deltaY > MAX_CLICK_MOVEMENT_PX) {
                isDragging = true;
            }
        };

        const cleanupPointerCapture = () => {
            if (pointerId !== null) {
                try {
                    if (element.hasPointerCapture(pointerId)) {
                        element.releasePointerCapture(pointerId);
                    }
                } catch { /* Squelch */ }
            }
        };

        const resetState = () => {
            pointerId = null;
            initialPointerDownEvent = null;
            isDragging = false;
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }

            // Use stopImmediatePropagation to prevent other listeners from being called
            event.stopImmediatePropagation();

            // Store the initial event before resetting state
            const downEvent = initialPointerDownEvent;

            // Cleanup
            cleanupPointerCapture();
            resetState();

            // Skip if already determined to be dragging
            if (isDragging) {
                return;
            }

            // Check if we should exclude this event
            if (shouldExclude(event)) {
                return;
            }

            const endTime = performance.now();
            const duration = endTime - startTime;
            const deltaX = Math.abs(event.clientX - startX);
            const deltaY = Math.abs(event.clientY - startY);

            if (
                duration < MAX_CLICK_DURATION_MS &&
                deltaX < MAX_CLICK_MOVEMENT_PX &&
                deltaY < MAX_CLICK_MOVEMENT_PX
            ) {
                if (downEvent) {
                    // Prevent event propagation and default behavior to avoid triggering other handlers
                    downEvent.preventDefault();
                    downEvent.stopPropagation();
                    handler(downEvent);
                }
            }
        };

        const handlePointerCancel = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }

            // Use stopImmediatePropagation to prevent other listeners from being called
            event.stopImmediatePropagation();

            cleanupPointerCapture();
            resetState();
        };

        const handlePointerDown = (event: PointerEvent) => {
            if (!event.isPrimary || pointerId !== null) {
                return; // Only process primary pointer and if not already tracking one
            }

            // Check if we should exclude this event early
            if (shouldExclude(event)) {
                return;
            }

            // Use stopImmediatePropagation to prevent other listeners from being called
            event.stopImmediatePropagation();

            pointerId = event.pointerId;
            initialPointerDownEvent = event;
            startX = event.clientX;
            startY = event.clientY;
            startTime = performance.now();
            isDragging = false;

            try {
                element.setPointerCapture(pointerId);
            } catch {
                // console.warn('Failed to set pointer capture:');
            }
        };

        const handleClick = (event: MouseEvent) => {
            // Check if we should exclude this event
            if (shouldExclude(event)) {
                return;
            }

            // Prevent event propagation and default behavior to avoid triggering other handlers
            event.preventDefault();
            event.stopPropagation();
            handler(event);
        };

        if (isTouchDevice) {
            // Add all listeners upfront for better performance with capture to ensure they run first
            element.addEventListener('pointerdown', handlePointerDown, { capture: true });
            element.addEventListener('pointermove', handlePointerMove, { capture: true });
            element.addEventListener('pointerup', handlePointerUp, { capture: true });
            element.addEventListener('pointercancel', handlePointerCancel, { capture: true });
        } else {
            element.addEventListener('click', handleClick, { capture: true });
        }

        return () => {
            if (isTouchDevice) {
                element.removeEventListener('pointerdown', handlePointerDown, { capture: true });
                element.removeEventListener('pointermove', handlePointerMove, { capture: true });
                element.removeEventListener('pointerup', handlePointerUp, { capture: true });
                element.removeEventListener('pointercancel', handlePointerCancel, { capture: true });

                // Cleanup any active pointer capture
                if (pointerId !== null) {
                    cleanupPointerCapture();
                    resetState();
                }
            } else {
                element.removeEventListener('click', handleClick, { capture: true });
            }
        };
    };
}