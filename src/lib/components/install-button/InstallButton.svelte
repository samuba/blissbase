<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { Dialog } from 'bits-ui';

	// TODO: add video for safari desktop

	let deferredPrompt: any;

	let showInstallButton = $state(false);
	let showIosInstallHowto = $state(false);
	let innerHeight = $state(700);
	let explanationDiv: HTMLDivElement | null = $state(null);

	const mode = $derived(browser ? detectIosDevice() : 'not-ios');

	function detectIosDevice() {
		if (!browser) return 'unknown';

		const userAgent = window.navigator.userAgent.toLowerCase();
		const platform = window.navigator.platform?.toLowerCase() ?? '';

		// iOS detection via user agent and platform
		const isSmallIosDevice = /iphone|ipod/i.test(userAgent) || /iphone|ipod/i.test(platform);

		const isIpad =
			/ipad/i.test(userAgent) ||
			// Modern iPad detection (reports as macOS)
			(/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);

		if (isSmallIosDevice) {
			return 'smallIosDevice';
		} else if (isIpad) {
			return 'ipad';
		}

		return 'not-ios';
	}

	function getPWADisplayMode() {
		if (!browser) return 'unknown';
		if (document.referrer.startsWith('android-app://')) return 'twa';
		if (window.matchMedia('(display-mode: browser)').matches) return 'browser';
		if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
		if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
		if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
		if (window.matchMedia('(display-mode: window-controls-overlay)').matches)
			return 'window-controls-overlay';

		return 'unknown';
	}

	onMount(() => {
		if (!browser) return;

		// Check if we're already in standalone mode (PWA already installed)
		if (getPWADisplayMode() === 'standalone') {
			showInstallButton = false;
			return;
		}

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

		// For iOS devices, show the button immediately to trigger the how-to dialog
		if (mode === 'smallIosDevice' || mode === 'ipad') {
			showInstallButton = true;
		}
		// For non-iOS devices, wait for the beforeinstallprompt event
		// The button will be shown when that event fires
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

	async function onInstallClick() {
		if (mode === 'smallIosDevice' || mode === 'ipad') {
			showIosInstallHowto = true;
			return;
		}

		await installPwa();
	}

	// does NOT work on iOS!
	async function installPwa() {
		if (!deferredPrompt) {
			console.log('Install prompt not available');
			// Hide the button if the prompt is not available
			showInstallButton = false;
			return;
		}

		try {
			// Show the prompt
			deferredPrompt.prompt();
			// Wait for the user to respond to the prompt
			const { outcome } = await deferredPrompt.userChoice;
			// Optionally, send analytics event with outcome of user choice
			console.log(`User response to the install prompt: ${outcome}`);
		} catch (error) {
			console.error('Error showing install prompt:', error);
		} finally {
			// We've used the prompt, and can't use it again, throw it away
			deferredPrompt = null;
			showInstallButton = false;
		}
	}
</script>

<svelte:window bind:innerHeight />

{#if showInstallButton}
	<button onclick={onInstallClick} class="btn"> App installieren </button>
{/if}

<Dialog.Root bind:open={showIosInstallHowto}>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-base-100 fixed inset-0 z-50" />
		<Dialog.Content class="fixed inset-0 z-50 flex flex-col items-center px-8 pb-2 outline-none">
			<div bind:this={explanationDiv} class="my-3 flex w-full items-center justify-between">
				<h3 class="text-center text-2xl">Installationsanleitung:</h3>
				<Dialog.Close class="btn btn-primary">Okay</Dialog.Close>
			</div>

			<video
				src="/ios-install-howto.mp4"
				autoplay
				loop
				muted
				playsinline
				disablepictureinpicture
				disableremoteplayback
				class="mx-auto max-h-[900px] flex-1 rounded-[3rem] object-contain"
				style="height: {innerHeight - ((explanationDiv?.offsetHeight ?? 0) + 30)}px"
			/>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
