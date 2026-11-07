import { browser } from '$app/environment';
import { startHintCooldown } from '$lib/components/HintBubble.svelte';

const STORAGE_KEY = `blissbase_offerings_nav_hint_dismissed`;
const REVEAL_SCROLL_Y = 2200;

class OfferingsNavHint {
	dismissed = $state(browser && localStorage.getItem(STORAGE_KEY) === `1`);
	revealed = $state(false);
	show = $derived(this.revealed && !this.dismissed);

	/** Reveal once the user scrolled past the hero. Call only from the home page. */
	onHomeScroll(scrollY: number) {
		if (scrollY < REVEAL_SCROLL_Y) return;
		this.revealed = true;
	}

	/** Hide again when leaving the home page without dismissing for good. */
	leaveHome() {
		this.revealed = false;
	}

	dismiss() {
		if (!this.dismissed) startHintCooldown();
		this.dismissed = true;
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, `1`);
	}
}

export const offeringsNavHint = new OfferingsNavHint();
