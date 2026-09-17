import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';

export class ShallowDialog {
	returnToPath: string;

	constructor(fallbackReturnTo: string) {
		this.returnToPath = fallbackReturnTo;
	}

	open({ href, state, replace = false }: { href: string; state: App.PageState; replace?: boolean }) {
		if (sameDialogState(page.state, state)) return;
		if (replace || hasDialogState(page.state)) {
			replaceState(href, state);
			return;
		}
		pushState(href, state);
	}

	close() {
		if (!hasDialogState(page.state)) return;
		replaceState(this.returnToPath, {});
	}
}

export const APP_HYDRATED_ATTR = `data-app-hydrated`;

/** Marks the document after SvelteKit `started` and history listeners are attached. */
export function markAppHydrated() {
	document.documentElement.setAttribute(APP_HYDRATED_ATTR, `true`);
}

/**
 * SvelteKit sets `started` and attaches history listeners after hydrate.
 * If the layout already marked the document, resolve immediately; otherwise wait one macrotask.
 */
export function afterClientHydration() {
	if (document.documentElement.getAttribute(APP_HYDRATED_ATTR) === `true`) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function hasDialogState(state: App.PageState) {
	return state.selectedEventId != null || state.selectedOfferingSlug != null;
}

function sameDialogState(current: App.PageState, next: App.PageState) {
	return (
		current.selectedEventId === next.selectedEventId &&
		current.selectedOfferingSlug === next.selectedOfferingSlug
	);
}
