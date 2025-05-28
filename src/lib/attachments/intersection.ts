import type { Attachment } from "svelte/attachments";

// Keep track of which callback is associated with each element
type IntersectionCallback = (entry: IntersectionObserverEntry) => void;
const intersectionCallbacks = new WeakMap<Element, IntersectionCallback>();

// Keep track of onIntersecting callbacks
const onIntersectingCallbacks = new WeakMap<Element, IntersectionCallback>();

// Keep track of which elements should trigger only once
const triggerOnlyOnceElements = new WeakSet<Element>();

// Use a single intersection observer instance per options
const intersectionObservers = new WeakMap<IntersectionObserverInit, IntersectionObserver>();

function createObserver(init: IntersectionObserverInit) {
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const callback = intersectionCallbacks.get(entry.target);
            if (callback) {
                callback(entry);
            }

            // Call onIntersecting callback if element is intersecting
            if (entry.isIntersecting) {
                const onIntersectingCallback = onIntersectingCallbacks.get(entry.target);
                if (onIntersectingCallback) {
                    onIntersectingCallback(entry);
                }
            }

            // If this element should trigger only once and is intersecting, clean it up
            if (triggerOnlyOnceElements.has(entry.target) && entry.isIntersecting) {
                observer.unobserve(entry.target);
                intersectionCallbacks.delete(entry.target);
                onIntersectingCallbacks.delete(entry.target);
                triggerOnlyOnceElements.delete(entry.target);
            }
        }
    }, init);
    intersectionObservers.set(init, observer);
    return observer;
}

/**
 * Creates an intersection observer attachment that monitors when an element intersects with its parent
 * or viewport based on the provided options.
 * 
 * This function is a Svelte attachment factory. Use it like:
 * `<div {@attach intersect({ callback: (entry) => console.log(entry), threshold: 0.5 })}></div>`
 *
 * @param options - The intersection observer options and callback
 * @param options.onIntersecting - Function called only when element is intersecting (visible)
 * @param options.callback - Function called when intersection changes (both entering and leaving)
 * @param options.triggerOnlyOnce - If true, callback will only be triggered once when element first intersects (default: false)
 * @param options.root - The element used as viewport (default: browser viewport)
 * @param options.rootMargin - Margin around the root (default: "0px")
 * @param options.threshold - Single number or array of intersection thresholds (default: 0)
 * @returns A Svelte attachment function that sets up the intersection observer
 */
export function intersect(options: IntersectionObserverInit & {
    callback?: IntersectionCallback;
    onIntersecting?: (entry: IntersectionObserverEntry) => void;
    triggerOnlyOnce?: boolean;
}): Attachment {
    // This is the Svelte attachment function
    return (element) => {
        if (!(element instanceof Element)) {
            throw new Error('Element must be an Element');
        }

        const observer = intersectionObservers.get(options) || createObserver(options);
        intersectionCallbacks.set(element, options.callback);

        // Store onIntersecting callback if provided
        if (options.onIntersecting) {
            onIntersectingCallbacks.set(element, options.onIntersecting);
        }

        // Track if this element should trigger only once
        if (options.triggerOnlyOnce) {
            triggerOnlyOnceElements.add(element);
        }

        observer.observe(element);

        // Return the cleanup function
        return () => {
            observer.unobserve(element);
            intersectionCallbacks.delete(element);
            onIntersectingCallbacks.delete(element);
            triggerOnlyOnceElements.delete(element);
        };
    };
} 