<script lang="ts">
	import '../app.css';
	import { updated } from '$app/state';
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { beforeNavigate } from '$app/navigation';
	import { browser } from '$app/environment';

	let { children } = $props();

	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	if (browser) {
		beforeNavigate(({ willUnload, to }) => {
			// do browser refresh if new version of website was deployed.
			if (updated.current && !willUnload && to?.url) {
				location.href = to.url.href;
			}
		});
	}
</script>

<svelte:head>
	<title>BlissBase</title>
	<meta name="description" content="Hippie Events in deiner Nähe" />
	{@html webManifestLink}
	{#if pwaAssetsHead.themeColor}
		<meta name="theme-color" content={pwaAssetsHead.themeColor.content} />
	{/if}
	{#each pwaAssetsHead.links as link}
		<link {...link} />
	{/each}
</svelte:head>

{@render children()}
