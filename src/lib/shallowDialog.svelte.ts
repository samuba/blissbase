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

/**
 * SvelteKit attaches history listeners after the first client macrotask.
 * replaceState before that can be overwritten by hydration.
 */
export function afterClientHydration() {
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
