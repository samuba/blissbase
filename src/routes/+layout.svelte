<script lang="ts">
	import '../app.css';
	import { page, updated } from '$app/state';
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { beforeNavigate, invalidate } from '$app/navigation';
	import { MetaTags, deepMerge } from 'svelte-meta-tags';
	import { onMount } from 'svelte';
	import { setupAutoRefresh } from '$lib/auto-refresh';
	import { user } from '$lib/user.svelte';
	import { getFavoriteEventIds } from '$lib/rpc/favorites.remote';
	import { invalidateAll } from '$app/navigation';
	import { navigationIsDelayed } from '$lib/components/navigationIsDelayed.svelte';
	import { fade } from 'svelte/transition';
	import { registerAuthCallbackFeedbackToast } from '$lib/authCallbackFeedbackToast.svelte';
	import LoginDialog from '$lib/components/LoginDialog.svelte';
	import { Toaster } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import TabsNavMobile from '$lib/components/TabsNavMobile.svelte';
	import TabsNavDesktop from '$lib/components/TabsNavDesktop.svelte';
	import { isActiveAppTab } from '$lib/components/tabsNav';

	let { data, children } = $props();
	let { jwtClaims, supabase, userId } = $derived(data);
	let metaTags = $derived(deepMerge(data.baseMetaTags, page.data.pageMetaTags));
	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	beforeNavigate(({ willUnload, to }) => {
		// do browser refresh if new version of website was deployed.
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});

	$effect(() => {
		user.id = userId;
	})

	onMount(() => {
		const cleanup = setupAutoRefresh();
		
		// Listen to Auth events to handle session refreshes and signouts
		const { data: authData } = supabase.auth.onAuthStateChange((event, newSession) => {
			console.log('authStateChange', newSession, event);
			if (event === 'SIGNED_OUT') {
				invalidateAll();
				getFavoriteEventIds().refresh();
			}
			if (newSession?.expires_at !== jwtClaims?.exp) {
				invalidate('supabase:auth');
			}
		});

		return () => {
			cleanup();
			authData.subscription.unsubscribe();
		};
	});

	registerAuthCallbackFeedbackToast();

	const showDesktopNav = $derived(!isActiveAppTab(page.url.pathname, resolve('/')));
</script>

<svelte:head>
	{@html webManifestLink}
	<meta name="theme-color" content={pwaAssetsHead?.themeColor?.content ?? '#efeae7'} />
	{#each pwaAssetsHead.links as link (`${link.rel}-${link.href ?? 'no-href'}`)}
		<link {...link} />
	{/each}
</svelte:head>

<MetaTags {...metaTags} />

<div class="min-h-dvh pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0">
	{#if showDesktopNav}
		<div class="sticky top-0 z-50 bg-base-200 py-4 hidden md:block">
			<TabsNavDesktop class="w-fit mx-auto" />
		</div>
	{/if}
	<div class="md:flex md:items-start">
		<div class={["min-w-0 flex-1"]}>
			{@render children()}
		</div>
	</div>
	<TabsNavMobile />
</div>

{#if $navigationIsDelayed}
	<div class="fixed inset-0 z-100 h-full w-full" in:fade={{ duration: 300 }}>
		<div class="absolute z-100 h-full w-full bg-white/30 backdrop-blur-sm"></div>
		<div class="absolute z-110 flex h-full w-full items-center justify-center text-4xl">
			<div class="rounded-full bg-base-200 p-3  size-20 animate-ping">
			</div>
			<div class="fixed rounded-full bg-base-200 p-3 shadow-md">
				<img src="/logo.svg" alt="Loading Blissbase" class=" size-16 min-w-16  animate-spin" />
			</div>
		</div>
	</div>
{/if}

<Toaster
	position="top-center"
	richColors
	class={[`pointer-events-auto z-200`]}
/>
<LoginDialog />