/**
 * Attaches a handler to an element that will be called when the element is clicked.
 * Is faster then onClick on mobile cuz it uses pointerdown instead of click.
 * 
 * @param handler - The handler to call when the element is clicked.
 * @returns A function that can be used to detach the handler.
 */
export function onPointerClick(handler: (event: PointerEvent | MouseEvent) => void) {
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    return (element: HTMLElement) => {
        if (isTouchDevice) {
            element.addEventListener('pointerdown', handler);
        } else {
            element.addEventListener('click', handler);
        }
    }
}