<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';

	let deferredPrompt: any;
	let showInstallButton = false;

	function isIos(): boolean {
		if (!browser) return false;

		const userAgent = window.navigator.userAgent.toLowerCase();
		const platform = window.navigator.platform?.toLowerCase() ?? '';

		// iOS detection via user agent and platform
		const isIosDevice = /ipad|iphone|ipod/.test(userAgent) || /ipad|iphone|ipod/.test(platform);

		// Modern iPad detection (reports as macOS)
		const isModernIpad = /macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;

		// Standalone mode check for iOS Safari
		const isStandalone = window.navigator.standalone === true;

		return isIosDevice || isModernIpad || isStandalone;
	}

	onMount(() => {
		if (!browser) return;

		console.log('isIos', isIos());
		console.log('navigator.standalone', window.navigator.standalone);

		window.addEventListener('beforeinstallprompt', (e) => {
			// Prevent Chrome 67 and earlier from automatically showing the prompt
			e.preventDefault();
			// Stash the event so it can be triggered later.
			deferredPrompt = e;
			// Update UI to notify the user they can add to home screen
			showInstallButton = true;
		});

		window.addEventListener('appinstalled', () => {
			// Hide the install button
			showInstallButton = false;
			// Clear the deferredPrompt so it can be garbage collected
			deferredPrompt = null;
			// Optionally, send analytics event to indicate successful install
			console.log('PWA was installed');
		});
	});

	onDestroy(() => {
		if (!browser) return;

		window.removeEventListener('beforeinstallprompt', (e) => {
			deferredPrompt = e;
		});
		window.removeEventListener('appinstalled', () => {
			deferredPrompt = null;
		});
	});

	async function handleInstallClick() {
		if (!deferredPrompt) {
			return;
		}
		// Show the prompt
		deferredPrompt.prompt();
		// Wait for the user to respond to the prompt
		const { outcome } = await deferredPrompt.userChoice;
		// Optionally, send analytics event with outcome of user choice
		console.log(`User response to the install prompt: ${outcome}`);
		// We've used the prompt, and can't use it again, throw it away
		deferredPrompt = null;
		showInstallButton = false;
	}
</script>

{#if showInstallButton}
	<button onclick={handleInstallClick} class="btn"> App installieren </button>
{/if}
