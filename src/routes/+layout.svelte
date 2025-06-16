<script lang="ts">
	import '../app.css';
	import { page, updated } from '$app/state';
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { beforeNavigate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { MetaTags, deepMerge } from 'svelte-meta-tags';
	import { onMount } from 'svelte';
	import { setupAutoRefresh } from '$lib/auto-refresh';

	let { data, children } = $props();
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

	onMount(() => {
		const cleanup = setupAutoRefresh();
		return cleanup;
	});
</script>

<svelte:head>
	{@html webManifestLink}
	{#if pwaAssetsHead.themeColor}
		<meta name="theme-color" content={pwaAssetsHead.themeColor.content} />
	{/if}
	{#each pwaAssetsHead.links as link}
		<link {...link} />
	{/each}
</svelte:head>

<MetaTags {...metaTags} />

{@render children()}
