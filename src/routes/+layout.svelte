<script lang="ts">
	import '../app.css';
	import { page, updated } from '$app/state';
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { beforeNavigate, invalidate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { MetaTags, deepMerge } from 'svelte-meta-tags';
	import { onMount } from 'svelte';
	import { setupAutoRefresh } from '$lib/auto-refresh';
	import { user } from '$lib/user.svelte';
	import { getFavoriteEventIds } from '$lib/favorites.remote';
	import { invalidateAll } from '$app/navigation';

	let { data, children } = $props();
	let { jwtClaims, supabase, userId } = $derived(data);
	let metaTags = $derived(deepMerge(data.baseMetaTags, page.data.pageMetaTags));
	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	if (browser) {
		beforeNavigate(({ willUnload, to }) => {
			// do browser refresh if new version of website was deployed.
			if (updated.current && !willUnload && to?.url) {
				location.href = to.url.href;
			}
		});
	}

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
</script>

<svelte:head>
	{@html webManifestLink}
	<meta name="theme-color" content={pwaAssetsHead?.themeColor?.content ?? '#efeae7'} />
	{#each pwaAssetsHead.links as link}
		<link {...link} />
	{/each}
</svelte:head>

<MetaTags {...metaTags} />

{@render children()}
