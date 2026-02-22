<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { Dialog } from '$lib/components/dialog';
	import { isPwa } from '$lib/isPwa.svelte';
	import { localeStore } from '../../../locales/localeStore.svelte';

	// TODO: add video for safari desktop

	const { class: className }: { class?: string } = $props();

	let deferredPrompt: any;

	let showInstallButton = $state(false);
	let showIosInstallHowto = $state(true);
	let innerHeight = $state(700);
	let explanationDiv: HTMLDivElement | null = $state(null);

	const mode = $derived(browser ? detectIosDevice() : 'not-ios');
	const iosVideoPrefix = $derived(browser ? getIosVideoPrefix() : 'ios18');

	function detectIosDevice() {
		if (!browser) return 'unknown';

		const userAgent = window.navigator.userAgent.toLowerCase();
		const platform = window.navigator.platform?.toLowerCase() ?? '';

		const isSmallIosDevice = /iphone|ipod/i.test(userAgent) || /iphone|ipod/i.test(platform);

		const isIpad =
			/ipad/i.test(userAgent) ||
			(/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);

		if (isSmallIosDevice) {
			return 'smallIosDevice';
		} else if (isIpad) {
			return 'ipad';
		}

		return 'not-ios';
	}

	/** Detects major iOS version from the UA string and returns the matching video prefix.
	 * @example getIosVideoPrefix() // 'ios26' on iOS 26+, 'ios18' otherwise */
	function getIosVideoPrefix(): 'ios18' | 'ios26' {
		const match = navigator.userAgent.match(/OS (\d+)[_\.]/);
		if (!match) return 'ios18';

		const majorVersion = parseInt(match[1], 10);
		return majorVersion >= 26 ? 'ios26' : 'ios18';
	}

	onMount(() => {
		if (!browser) return;

		if (isPwa.value) {
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
	<button onclick={onInstallClick} class={['btn btn-primary w-fit', className]}>
		App installieren <i class="icon--ph-app-store"></i>
	</button>
{/if}

<Dialog.Root bind:open={showIosInstallHowto}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated class="bg-base-100" />
		<Dialog.ContentAnimated class="fixed inset-0 z-50 flex flex-col items-center px-8 pb-2 outline-none bg-base-200">
			<div bind:this={explanationDiv} class="flex flex-col justify-center items-center w-full h-12 my-3">
				<div class="flex w-full items-center justify-between">
					<h3 class="text-center text-xl leading-tight">Installationsanleitung</h3>
					<Dialog.Close class="btn btn-primary btn-circle absolute top-1 right-3">
						<i class="icon-[ph--x] size-5"></i>
					</Dialog.Close>
				</div>
				<span class="leading-tight text-sm w-full">So installierst du die App auf deinem iPhone</span>
			</div>

			<video
				src="/{iosVideoPrefix}-install-howto-{localeStore.locale}.mp4"
				autoplay
				loop
				muted
				playsinline
				disablepictureinpicture
				disableremoteplayback
				class="mx-auto flex-1 rounded-[3rem] object-contain"
				style="height: {innerHeight - ((explanationDiv?.offsetHeight ?? 0) + 30)}px"
			/>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
