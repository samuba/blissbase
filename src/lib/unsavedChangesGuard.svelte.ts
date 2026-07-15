import { beforeNavigate } from "$app/navigation";
import { onMount } from "svelte";

const DEFAULT_ARM_DELAY_MS = 500;

/** Call during component init — registers `beforeNavigate` and arms after a short hydration delay. */
export class UnsavedChangesGuard {
	isDirty = $state(false);
	#armed = false;

	constructor(args: { armDelayMs?: number; confirmMessage?: string } = {}) {
		const armDelayMs = args.armDelayMs ?? DEFAULT_ARM_DELAY_MS;
		const confirmMessage = args.confirmMessage ?? /* wc-include */ `Du hast ungespeicherte Änderungen. Möchtest du diese Seite wirklich verlassen?`;

		onMount(() => {
			const timeout = setTimeout(() => {
				this.#armed = true;
			}, armDelayMs);
			return () => clearTimeout(timeout);
		});

		beforeNavigate((navigation) => {
			if (!this.isDirty) return;
			if (navigation.willUnload) return; // handled by `handleBeforeUnload` / svelte:window
			if (!confirm(confirmMessage)) navigation.cancel();
		});
	}

	markDirty = () => {
		if (!this.#armed) return;
		this.isDirty = true;
	};

	clear = () => {
		this.isDirty = false;
	};

	handleBeforeUnload = (event: BeforeUnloadEvent) => {
		if (!this.isDirty) return;
		event.preventDefault();
	};
}
