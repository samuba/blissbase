import { browser } from "$app/environment";
import { page } from "$app/state";
import { fireConfetti } from "$lib/confetti";
import { FLASH_COOKIE_NAME, FLASH_KEYS, type FlashKey } from "$lib/flash";
import { toast } from "svelte-sonner";

const flashToasts: Record<FlashKey, () => void> = {
	offeringCreated: () => /* @wc-include */ toast.success(`Angebot erstellt!`),
	eventCreated: () => /* @wc-include */ toast.success(`Event erstellt!`),
	offeringListed: () => /* @wc-include */ toast.success(`Angebot wurde aktiviert`, { description: `Es ist jetzt für andere Nutzer sichtbar.` }),
	offeringUnlisted: () => /* @wc-include */ toast.success(`Angebot wurde deaktiviert`, { description: `Andere können es nicht mehr sehen.` }),
	offeringDeleted: () => /* @wc-include */ toast.success(`Angebot wurde gelöscht.`),
	offeringUpdated: () => /* @wc-include */ toast.success(`Angebot wurde aktualisiert.`),
};

const celebrateKeys = new Set<FlashKey>([`offeringCreated`, `eventCreated`]);

function playFlash(key: FlashKey) {
	flashToasts[key]();
	if (celebrateKeys.has(key)) fireConfetti();
}

/** Immediately shows a flash toast. For client-side flows without a redirect (e.g. after awaiting a command). */
export function showFlashToast(key: FlashKey) {
	playFlash(key);
}

/**
 * Shows toasts queued on the server via `setFlash` (post-redirect flash messages).
 * Call once from the root layout `<script>` during component initialization.
 */
export function registerFlashToast() {
	$effect(() => {
		if (!browser) return;
		void page.url; // re-check the cookie after every navigation

		const key = consumeFlashCookie();
		if (!key) return;
		playFlash(key);
	});
}

function consumeFlashCookie(): FlashKey | undefined {
	const entry = document.cookie.split(`; `).find((row) => row.startsWith(`${FLASH_COOKIE_NAME}=`));
	if (!entry) return undefined;

	console.log(`consuming flash cookie`, entry);

	document.cookie = `${FLASH_COOKIE_NAME}=; path=/; max-age=0`;

	const value = decodeURIComponent(entry.slice(FLASH_COOKIE_NAME.length + 1));
	if (!FLASH_KEYS.includes(value as FlashKey)) return undefined;
	return value as FlashKey;
}
