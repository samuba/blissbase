import { navigating } from "$app/state";

class NavigationIsDelayedStore {
	#timer: ReturnType<typeof setTimeout> | undefined;
	delayed = $state(false);

	constructor() {
		$effect.root(() => {
			$effect(() => {
				const current = navigating;
				if (this.#timer) clearTimeout(this.#timer);
				if (current) {
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
