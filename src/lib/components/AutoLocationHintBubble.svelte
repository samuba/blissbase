<script lang="ts" module>
	let dismissed = $state(false);

	export function dismissAutoLocationHint() {
		dismissed = true;
	}
</script>

<script lang="ts">
	import { page } from "$app/state";
	import HintBubble from "$lib/components/HintBubble.svelte";
	import { setLocationInteractedCookie } from "$lib/cookie-utils";

	const { autoDetectedCity } = $derived(page.data);
	const show = $derived(Boolean(autoDetectedCity) && !dismissed);

	function dismissWithCookie() {
		dismissed = true;
		setLocationInteractedCookie();
	}
</script>

{#if autoDetectedCity}
	<HintBubble
		open={show}
		side="top"
		testId="auto-location-hint"
		closeTestId="auto-location-hint-close"
		class="w-64 sm:w-72"
		onDismiss={dismissWithCookie}
	>
		Dir werden Events um <b>{autoDetectedCity}</b> angezeigt. Wenn das nicht dein Standort ist, ändere ihn hier.
	</HintBubble>
{/if}
