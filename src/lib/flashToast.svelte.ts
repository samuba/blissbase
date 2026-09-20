import { browser } from "$app/environment";
import { page } from "$app/state";
import { fireConfetti } from "$lib/confetti";
import { FLASH_COOKIE_NAME, FLASH_KEYS, type FlashKey } from "$lib/flash";
import { toast } from "svelte-sonner";

const offeringCreatedMessage = /* @wc-include */ `Angebot erstellt!`;
const eventCreatedMessage = /* @wc-include */ `Event erstellt!`;
const offeringListedMessage = /* @wc-include */ `Angebot wurde aktiviert`;
const offeringListedDescription = /* @wc-include */ `Es ist jetzt für andere Nutzer sichtbar.`;
const offeringUnlistedMessage = /* @wc-include */ `Angebot wurde deaktiviert`;
const offeringUnlistedDescription = /* @wc-include */ `Andere können es nicht mehr sehen.`;
const offeringDeletedMessage = /* @wc-include */ `Angebot wurde gelöscht.`;
const offeringUpdatedMessage = /* @wc-include */ `Angebot wurde aktualisiert.`;
const eventUpdatedMessage = /* @wc-include */ `Event wurde aktualisiert.`;
const eventDeletedMessage = /* @wc-include */ `Event wurde gelöscht.`;

const flashToasts: Record<FlashKey, () => void> = {
	offeringCreated: () => toast.success(offeringCreatedMessage),
	eventCreated: () => toast.success(eventCreatedMessage),
	offeringListed: () => toast.success(offeringListedMessage, { description: offeringListedDescription }),
	offeringUnlisted: () => toast.success(offeringUnlistedMessage, { description: offeringUnlistedDescription }),
	offeringDeleted: () => toast.success(offeringDeletedMessage),
	offeringUpdated: () => toast.success(offeringUpdatedMessage),
	eventUpdated: () => toast.success(eventUpdatedMessage),
	eventDeleted: () => toast.success(eventDeletedMessage),
};

const celebrateKeys = new Set<FlashKey>([`offeringCreated`, `eventCreated`]);

function playFlash(key: FlashKey) {
	flashToasts[key]();
	if (celebrateKeys.has(key)) fireConfetti();
}

function tryPlayFlash(key: FlashKey) {
	try {
		playFlash(key);
	} catch (error) {
		console.error(`Failed to show flash toast`, error);
	}
}

/** Immediately shows a flash toast. For client-side flows without a redirect (e.g. after awaiting a command). */
export function showFlashToast(key: FlashKey) {
	tryPlayFlash(key);
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
		tryPlayFlash(key);
	});
}

// @wc-ignore
function consumeFlashCookie(): FlashKey | undefined {
	const entry = document.cookie.split(`; `).find((row) => row.startsWith(`${FLASH_COOKIE_NAME}=`));
	if (!entry) return undefined;

	console.log(`consuming flash cookie`, entry);

	document.cookie = `${FLASH_COOKIE_NAME}=; path=/; max-age=0`;

	const value = decodeURIComponent(entry.slice(FLASH_COOKIE_NAME.length + 1));
	if (!FLASH_KEYS.includes(value as FlashKey)) return undefined;
	return value as FlashKey;
}
