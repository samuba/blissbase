const CLOSE_ANIMATION_MS = 200;

/** Shared open/close timing for shallow-routed details dialogs. */
export class ShallowDialogState {
	open = $state(false);
	noEnterAnimation = $state(false);
	#isClosing = false;
	#closeTimeout: ReturnType<typeof setTimeout> | undefined;

	show(args?: { noEnterAnimation?: boolean }) {
		this.cancelPendingClose();
		this.noEnterAnimation = args?.noEnterAnimation ?? false;
		this.open = true;
	}

	cancelPendingClose() {
		if (this.#closeTimeout) {
			clearTimeout(this.#closeTimeout);
			this.#closeTimeout = undefined;
		}
		this.#isClosing = false;
	}

	/**
	 * Hides the dialog, then runs `clear` after the close animation so content
	 * does not unmount mid-transition.
	 */
	closeGracefully(clear?: () => void) {
		if (this.#isClosing) return;
		if (!this.open) return;

		this.#isClosing = true;
		this.open = false;
		this.#closeTimeout = setTimeout(() => {
			clear?.();
			this.#isClosing = false;
			this.#closeTimeout = undefined;
		}, CLOSE_ANIMATION_MS);
	}
}

/** Subscribe to Navigation API URL changes; returns an unsubscribe. */
export function onNavigationUrlChange(handler: (url: URL) => void) {
	const onUrlChanged = (e: { destination: NavigationDestination }) => {
		handler(new URL(e.destination.url));
	};
	navigation.addEventListener(`navigate`, onUrlChanged);
	return () => navigation.removeEventListener(`navigate`, onUrlChanged);
}
