<script lang="ts">
	import type { PublicProfileSocialLink } from '$lib/rpc/profile.common';
	import {
		socialIconClass,
		socialIconColorClass,
		socialLabel,
		usernameUrlPrefix
	} from '$lib/socialLinks';

	let {
		socialLinks,
		class: className,
		class2: className2
	}: {
		socialLinks: PublicProfileSocialLink[];
		class?: string;
		class2?: string;
	} = $props();

	const socialLinkRowsMobile = $derived(chunkBalanced(socialLinks, 2));
	const socialLinkRowsDesktop = $derived(chunkBalanced(socialLinks, 4));
	const websiteLinkCount = $derived(socialLinks.filter((link) => link.type === `website`).length);

	function openLink(link: PublicProfileSocialLink) {
		let url = link.value;
		let prefix = usernameUrlPrefix(link.type);
		if (link.type === `phone`) prefix = `tel:`;
		if (link.type === `email`) prefix = `mailto:`;
		if (link.type === `whatsapp`) prefix = `https://wa.me/`;
		if (link.type === `telegram`) prefix = `https://t.me/`;
		if (prefix) url = `${prefix}${url}`;
		window.open(url, `_blank`, `noopener,noreferrer`);
	}

	function websiteLabel(url: string) {
		// Only show website hostname if there is more than one website.
		if (websiteLinkCount <= 1) return socialLabel(`website`);
		try {
			return new URL(url).hostname;
		} catch {
			return socialLabel(`website`);
		}
	}

	/**
	 * Splits items into balanced rows, preserving order, with at most `maxPerRow` items per row.
	 *
	 * @example
	 * chunkBalanced([1, 2, 3, 4, 5, 6], 5) // [[1, 2, 3], [4, 5, 6]]
	 */
	function chunkBalanced<T>(items: T[], maxPerRow: number): T[][] {
		const n = items.length;
		if (n <= maxPerRow) return [items];
		const rows = Math.ceil(n / maxPerRow);
		const chunks: T[][] = [];
		let i = 0;
		for (let r = 0; r < rows; r++) {
			const remaining = n - i;
			const remainingRows = rows - r;
			const thisRow = Math.ceil(remaining / remainingRows);
			chunks.push(items.slice(i, i + thisRow));
			i += thisRow;
		}
		return chunks;
	}
</script>

{#snippet socialLinkButton(link: PublicProfileSocialLink)}
	<button
		type="button"
		class={[`btn btn-sm gap-1.5 hover:cursor-pointer`]}
		onclick={() => openLink(link)}
	>
		<i class={[socialIconClass(link.type), socialIconColorClass(link.type), `size-5`]}></i>
		{#if link.type === `website`}
			{websiteLabel(link.value)}
		{:else}
			{socialLabel(link.type)}
		{/if}
	</button>
{/snippet}

{#if socialLinks?.length}
	<div class={[`flex flex-col flex-wrap items-center gap-2 sm:hidden`, className]}>
		{#each socialLinkRowsMobile as row, rowIndex (rowIndex)}
			<div class={["flex justify-center gap-2", className2]}>
				{#each row as link, i (`${link.type}-${rowIndex}-${i}`)}
					{@render socialLinkButton(link)}
				{/each}
			</div>
		{/each}
	</div>
	<div class={[`hidden flex-col flex-wrap items-center gap-2 sm:flex`, className]}>
		{#each socialLinkRowsDesktop as row, rowIndex (rowIndex)}
			<div class={["flex justify-center gap-4", className2]}>
				{#each row as link, i (`${link.type}-${rowIndex}-${i}`)}
					{@render socialLinkButton(link)}
				{/each}
			</div>
		{/each}
	</div>
{/if}
