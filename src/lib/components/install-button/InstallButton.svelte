<script lang="ts">
	import { browser } from "$app/env";
	import { onMount, onDestroy } from "svelte";
	import { Dialog } from "#lib/components/dialog/index.ts";
	import { isPwa } from "#lib/isPwa.svelte.ts";
	import { localeStore } from "../../../locales/localeStore.svelte";

	// TODO: add video for safari desktop

	const { class: className }: { class?: string } = $props();

	let deferredPrompt: any;

	let showInstallButton = $state(false);
	let showIosInstallHowto = $state(false);
	let videoFailed = $state(false);

	const mode = $derived(browser ? detectIosDevice() : "not-ios");
	const iosBrowser = $derived(browser ? detectIosBrowser() : "safari");
	const iosVideoPrefix = $derived(browser ? getIosVideoPrefix() : "ios18");

	function detectIosDevice() {
		if (!browser) return "unknown";

		const userAgent = window.navigator.userAgent.toLowerCase();
		const platform = window.navigator.platform?.toLowerCase() ?? "";
		const isSmallIosDevice = /iphone|ipod/i.test(userAgent) || /iphone|ipod/i.test(platform);
		const isIpad = /ipad/i.test(userAgent) || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);

		if (isSmallIosDevice) {
			return "smallIosDevice";
		} else if (isIpad) {
			return "ipad";
		}

		return "not-ios";
	}

	/** Detects the iOS browser engine. Every iOS browser uses WebKit, but only
	 * Safari runs the "Add to Home Screen" flow the how-to video shows. Chrome
	 * (`CriOS`), Firefox (`FxiOS`), Edge (`EdgiOS`) and Opera (`OPiOS`/`OPT`) on
	 * iOS cannot install the PWA, so they get text instructions instead. */
	function detectIosBrowser(): "safari" | "other" {
		if (!browser) return "safari";

		const ua = navigator.userAgent;
		const isNonSafari = /crios|fxios|edgios|opios|opt\//i.test(ua);
		return isNonSafari ? "other" : "safari";
	}

	/** Detects iOS version from the UA `Version/` field (Apple's user-facing version)
	 * since `CPU iPhone OS` still reports the old internal build number.
	 * @example getIosVideoPrefix() // 'ios26' on iOS 26+, 'ios18' otherwise */
	function getIosVideoPrefix(): "ios18" | "ios26" {
		const ua = navigator.userAgent;
		const versionMatch = ua.match(/Version\/(\d+)\./);
		if (versionMatch) {
			return parseInt(versionMatch[1], 10) >= 26 ? "ios26" : "ios18";
		}

		const osMatch = ua.match(/OS (\d+)[_\.]/);
		if (osMatch) {
			return parseInt(osMatch[1], 10) >= 26 ? "ios26" : "ios18";
		}

		return "ios18";
	}

	onMount(() => {
		if (!browser) return;

		if (isPwa.value) {
			showInstallButton = false;
			return;
		}

		window.addEventListener("beforeinstallprompt", (e) => {
			// Prevent Chrome 67 and earlier from automatically showing the prompt
			e.preventDefault();
			// Stash the event so it can be triggered later.
			deferredPrompt = e;
			// Update UI to notify the user they can add to home screen
			showInstallButton = true;
		});

		window.addEventListener("appinstalled", () => {
			// Hide the install button
			showInstallButton = false;
			// Clear the deferredPrompt so it can be garbage collected
			deferredPrompt = null;
			// Optionally, send analytics event to indicate successful install
			console.log("PWA was installed");
		});

		// For iOS devices, show the button immediately to trigger the how-to dialog
		if (mode === "smallIosDevice" || mode === "ipad") {
			showInstallButton = true;
		}
		// For non-iOS devices, wait for the beforeinstallprompt event
		// The button will be shown when that event fires
	});

	onDestroy(() => {
		if (!browser) return;

		window.removeEventListener("beforeinstallprompt", (e) => {
			deferredPrompt = e;
		});
		window.removeEventListener("appinstalled", () => {
			deferredPrompt = null;
		});
	});

	async function onInstallClick() {
		if (mode === "smallIosDevice" || mode === "ipad") {
			videoFailed = false;
			showIosInstallHowto = true;
			return;
		}

		await installPwa();
	}

	// does NOT work on iOS!
	async function installPwa() {
		if (!deferredPrompt) {
			console.log("Install prompt not available");
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
			console.error("Error showing install prompt:", error);
		} finally {
			// We've used the prompt, and can't use it again, throw it away
			deferredPrompt = null;
			showInstallButton = false;
		}
	}
</script>

{#if showInstallButton}
	<button onclick={onInstallClick} class={["btn sm:btn-md btn-sm w-fit", className]}>
		App installieren <i class="icon--ph-app-store"></i>
	</button>
{/if}

<Dialog.Root bind:open={showIosInstallHowto}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated class="bg-base-100" />
		<Dialog.ContentAnimated class="bg-base-200 fixed inset-0 z-50 flex flex-col items-center px-8 pb-4 outline-none">
			<div class="my-3 flex h-12 w-full flex-col items-center justify-center">
				<div class="flex w-full items-center justify-between">
					<h3 class="text-center text-xl leading-tight">Installationsanleitung</h3>
					<Dialog.Close class="btn btn-primary btn-circle absolute top-1 right-3" aria-label="Schließen" data-testid="ios-install-close">
						<i class="icon-[ph--x] size-5"></i>
					</Dialog.Close>
				</div>
				<span class="w-full text-sm leading-tight">So installierst du die App auf deinem iPhone</span>
			</div>

			{#if iosBrowser === `other`}
				<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
					<i class="icon-[ph--arrow-square-out] text-primary size-12"></i>
					<p class="text-lg leading-snug">Öffne diese Seite in Safari, um die App zu installieren.</p>
					<p class="text-sm opacity-70">Andere Browser auf dem iPhone können keine Apps installieren.</p>
				</div>
			{:else if videoFailed}
				<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
					<i class="icon-[ph--share-network] text-primary size-12"></i>
					<p class="text-lg leading-snug">Tippe in Safari auf das Teilen-Symbol und dann auf „Zum Home-Bildschirm“.</p>
				</div>
			{:else}
				<video
					src={`/${iosVideoPrefix}-install-howto-${localeStore.locale}.mp4`}
					poster="/blissbase-poster.png"
					preload="auto"
					autoplay
					loop
					muted
					playsinline
					disablepictureinpicture
					disableremoteplayback
					onerror={() => (videoFailed = true)}
					class="mx-auto min-h-0 w-full flex-1 rounded-[3rem] object-contain"
				></video>
			{/if}

			<Dialog.Close type="button" class="btn btn-primary mt-2 w-full shrink-0" data-testid="ios-install-okay">Okay</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
