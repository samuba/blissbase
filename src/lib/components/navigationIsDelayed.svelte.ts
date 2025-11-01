
import { derived, type Readable } from "svelte/store";
import { navigating } from "$app/stores";

let timer: NodeJS.Timeout;

export const navigationIsDelayed = derived(navigating, (newValue, set: (value: boolean) => void) => {
    if (timer) clearTimeout(timer);
    if (newValue) timer = setTimeout(() => set(true), 500);
    set(false);
});