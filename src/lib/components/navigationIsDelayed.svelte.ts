import { navigating } from "$app/state";

class NavigationIsDelayedStore {
	#timer: ReturnType<typeof setTimeout> | undefined;
	delayed = $state(false);

	constructor() {
		$effect.root(() => {
			$effect(() => {
				// Kit 3: `navigating` is always an object; properties are null when idle.
				const inFlight = navigating.type !== null;
				if (this.#timer) clearTimeout(this.#timer);
				if (inFlight) {
					this.delayed = false;
					this.#timer = setTimeout(() => {
						this.delayed = true;
					}, 500);
					return;
				}
				this.delayed = false;
			});
		});
	}
}

export const navigationIsDelayed = new NavigationIsDelayedStore();
