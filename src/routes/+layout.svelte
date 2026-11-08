<script lang="ts">
	import "../app.css";
	import { page, updated } from "$app/state";
	import { pwaInfo } from "virtual:pwa-info";
	import { pwaAssetsHead } from "virtual:pwa-assets/head";
	import { beforeNavigate, invalidate } from "$app/navigation";
	import { MetaTags, deepMerge } from "svelte-meta-tags";
	import { onMount } from "svelte";
	import { setupAutoRefresh } from "#lib/auto-refresh.ts";
	import { user } from "#lib/user.svelte.ts";
	import { getFavoriteEventIds } from "#lib/rpc/favorites.remote.ts";
	import { refreshAll } from "$app/navigation";
	import { navigationIsDelayed } from "#lib/components/navigationIsDelayed.svelte.ts";
	import { fade } from "svelte/transition";
	import { registerAuthCallbackFeedbackToast } from "#lib/authCallbackFeedbackToast.svelte.ts";
	import { registerFlashToast } from "#lib/flashToast.svelte.ts";
	import LoginDialog from "#lib/components/LoginDialog.svelte";
	import ContactBubble from "#lib/components/ContactBubble.svelte";
	import { Toaster } from "svelte-sonner";
	import TabsNavMobile from "#lib/components/TabsNavMobile.svelte";
	import TabsNavDesktop from "#lib/components/TabsNavDesktop.svelte";
	import PeekFooter from "#lib/components/PeekFooter.svelte";
	import LogoLoader from "#lib/components/LogoLoader.svelte";
	import EventDetailsDialog from "./EventDetailsDialog.svelte";
	import { isEventOrOfferingListPath } from "#lib/routes.ts";
	import { markAppHydrated } from "#lib/shallowDialog.svelte.ts";

	let { data, children } = $props();
	let { jwtClaims, supabase, userId } = $derived(data);
	let metaTags = $derived(deepMerge(data.baseMetaTags, page.data.pageMetaTags));
	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : "");

	beforeNavigate(({ willUnload, to, shallow, type }) => {
		if (shallow && type === "goto") return;

		// do browser refresh if new version of website was deployed.
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});

	$effect(() => {
		user.id = userId;
	});

	onMount(() => {
		const cleanup = setupAutoRefresh();
		window.setTimeout(markAppHydrated, 0);

		// Listen to Auth events to handle session refreshes and signouts
		const { data: authData } = supabase.auth.onAuthStateChange((event, newSession) => {
			console.log("authStateChange", newSession, event);
			if (event === "SIGNED_OUT") {
				refreshAll();
				getFavoriteEventIds().refresh();
			}
			if (newSession?.expires_at !== jwtClaims?.exp) {
				invalidate("supabase:auth");
			}
		});

		return () => {
			cleanup();
			authData.subscription.unsubscribe();
		};
	});

	registerAuthCallbackFeedbackToast();
	registerFlashToast();

	// Home and offerings list embed their own TabsNavDesktop; every other page uses the layout nav.
	// Shallow dialogs push a detail URL — don't mount a second nav over the list while they're open.
	const showDesktopNav = $derived(
		page.state.selectedOfferingSlug == null &&
			page.state.selectedEventId == null &&
			!isEventOrOfferingListPath({ pathname: page.url.pathname, origin: page.url.origin }),
	);
</script>

<svelte:head>
	{@html webManifestLink}
	<meta name="theme-color" content={pwaAssetsHead?.themeColor?.content ?? "#efeae7"} />
	{#each pwaAssetsHead.links as link (`${link.rel}-${link.href ?? "no-href"}`)}
		<link {...link} />
	{/each}
</svelte:head>

<MetaTags {...metaTags} />

<!-- Bottom padding clears fixed chrome: mobile tab bar (4rem) + peek footer (2rem + border); desktop peek only. -->
<div class="min-h-dvh pb-[calc(4rem+2rem+1px+env(safe-area-inset-bottom))] md:pb-[calc(2rem+1px)]">
	{#if showDesktopNav}
		<div class="bg-base-200 sticky top-0 z-50 hidden py-4 md:block">
			<TabsNavDesktop class="mx-auto w-fit" />
		</div>
	{/if}
	<div class="md:flex md:items-start">
		<div class={["min-w-0 flex-1"]}>
			{@render children()}
		</div>
	</div>
	<PeekFooter />
	<TabsNavMobile />
</div>

{#if navigationIsDelayed.delayed}
	<div class="fixed inset-0 z-100 h-full w-full" in:fade={{ duration: 300 }}>
		<div class="absolute z-100 h-full w-full bg-white/30 backdrop-blur-sm"></div>
		<div class="absolute z-110 flex h-full w-full items-center justify-center">
			<div class="bg-primary size-22 animate-ping rounded-full p-3"></div>
			<div class="bg-base-200 fixed rounded-full p-3 shadow-md">
				<LogoLoader class="size-22 min-w-22" aria-label="Loading Blissbase" />
			</div>
		</div>
	</div>
{/if}

<Toaster position="top-center" richColors class={[`pointer-events-auto z-200`]} />
<LoginDialog />
<ContactBubble />

<EventDetailsDialog />
