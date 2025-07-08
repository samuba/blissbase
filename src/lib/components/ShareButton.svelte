<script lang="ts">
	import { browser } from '$app/environment';
	import { Popover } from 'bits-ui';

	const { title, text, url }: { title?: string; text?: string; url?: string } = $props();

	const isAppleDevice = $derived(
		browser
			? navigator.userAgent.includes('Mac') ||
					navigator.userAgent.includes('iPhone') ||
					navigator.userAgent.includes('iPad')
			: false
	);

	let showCopiedNotice = $state(false);
	let customAnchor = $state<HTMLButtonElement>();

	async function share() {
		if (!navigator.share) {
			await copyToClipboard();
			return;
		}

		await navigator.share({ url, title, text });
	}

	async function copyToClipboard() {
		await navigator.clipboard.writeText(url ?? '');
		showCopiedNotice = true;
		setTimeout(() => (showCopiedNotice = false), 2000);
	}
</script>

<button class="btn" bind:this={customAnchor}>
	<!-- Desktop -->
	<div onclick={copyToClipboard} class="hidden items-center gap-1.5 pointer-fine:flex">
		<i class="icon-[ph--clipboard] size-5"></i>
		Link kopieren
	</div>

	<!-- Mobile -->
	<div onclick={share} class="hidden items-center gap-1.5 pointer-coarse:flex">
		{#if isAppleDevice}
			<i class="icon-[lucide--share] size-5"></i>
		{:else}
			<i class="icon-[ph--share-network] size-5"></i>
		{/if}
		Teilen
	</div>
</button>

<Popover.Root bind:open={showCopiedNotice}>
	<Popover.Content
		{customAnchor}
		class={[
			'card bg-accent text-accent-content flex  flex-row gap-1.5 px-3 py-2 shadow-lg',
			'data-[state=open]:animate-in',
			'data-[state=open]:ease-out',
			'data-[state=open]:fade-in',
			'data-[state=open]:duration-300',
			'data-[state=closed]:animate-out',
			'data-[state=closed]:ease-in',
			'data-[state=closed]:fade-out',
			'data-[state=closed]:duration-150'
		]}
	>
		<i class="icon-[ph--check-circle] inline-block size-5"></i>
		<span class="">Link kopiert</span>
		<Popover.Arrow />
	</Popover.Content>
</Popover.Root>
