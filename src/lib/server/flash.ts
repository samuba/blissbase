import { getRequestEvent } from "$app/server";
import { FLASH_COOKIE_NAME, type FlashKey } from "$lib/flash";

/**
 * Queues a one-shot flash message.
 * Is e.g. being used to show a toast on the client after the next
 * navigation (e.g. following a post-submit redirect). The toast itself is
 * defined in `$lib/flashToast.svelte.ts`.
 */
export function setFlash(key: FlashKey) {
	getRequestEvent().cookies.set(FLASH_COOKIE_NAME, key, {
		path: `/`,
		httpOnly: false, // read and cleared by the client
		sameSite: `lax`,
		maxAge: 60,
	});
}
