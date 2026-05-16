<script lang="ts">
	import EventCard from '$lib/components/EventCard.svelte';
	import { type PublicProfileSocialLink } from '$lib/rpc/profile.common.js';
	import { routes } from '$lib/routes';
	import { socialIconClass, socialIconColorClass, socialLabel, usernameUrlPrefix } from '$lib/socialLinks';
	import { resolve } from '$app/paths';

	let { data } = $props();
	const { profile, upcomingEvents, userId } = $derived(data);
	const isOwnProfile = $derived(Boolean(profile.id === userId));

	function openLink(link: PublicProfileSocialLink) {
		let url = link.value;
		let prefix = usernameUrlPrefix(link.type);
		if (link.type === `phone`) prefix = `tel:`;
		if (link.type === `email`) prefix = `mailto:`;
		if (link.type === `whatsapp`) prefix = `https://wa.me/`;
		if (link.type === `telegram`) prefix = `https://t.me/`;
		if (prefix) url = prefix + url;
		window.open(url, `_blank`, `noopener,noreferrer`);
	}

	function websiteLabel(url: string) {
		// only show website hostname if we have more than one website 
		if (profile.socialLinks.filter(x => x.type === `website`).length <= 1) {
			return socialLabel(`website`);
		}
		try {
			return new URL(url).hostname;
		} catch {
			return socialLabel(`website`);
		}
	}

	/**
	 * Splits items into balanced rows, preserving order, with at most `maxPerRow`
	 * items per row. Avoids unbalanced tails (e.g. 6 items -> [3,3] instead of [5,1]).
	 *
	 * @example
	 * chunkBalanced([1,2,3,4,5,6], 5) // => [[1,2,3], [4,5,6]]
	 * chunkBalanced([1,2,3,4,5,6,7], 4) // => [[1,2,3,4], [5,6,7]]
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

	const socialLinkRowsMobile = $derived(chunkBalanced(profile.socialLinks, 2));
	const socialLinkRowsDesktop = $derived(chunkBalanced(profile.socialLinks, 4));
</script>

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 sm:pt-4 md:pt-0">
	<div class="bg-base-100 sm:rounded-box overflow-hidden shadow">
		<div class="relative">
			{#if profile.bannerImageUrl}
				<div class="bg-base-200 aspect-2/1 w-full overflow-hidden sm:aspect-3/1">
					<img
						src={profile.bannerImageUrl}
						alt=""
						class="size-full object-cover"
					/>
				</div>
			{/if}

			<div
				class={[
					`flex flex-col items-center gap-6 px-4 pb-6`,
					profile.bannerImageUrl ? `-mt-17` : `pt-8`
				]}
			>
				<div class="relative flex w-full max-w-sm flex-row items-center justify-center drop-shadow sm:w-fit sm:max-w-none">
					{#if profile.profileImageUrl}
						<img
							src={profile.profileImageUrl}
							alt=""
							class={[
								`border-base-100 bg-base-100 z-10 size-32 shrink-0 rounded-full border-4 object-cover`,
								profile.bannerImageUrl ? `` : `mt-0`
							]}
						/>
					{:else}
						<div
							class={[
								`border-base-100 bg-primary/15 text-primary z-10 flex size-28 shrink-0 items-center justify-center rounded-full border-4 sm:size-32`
							]}
						>
							<i class="icon-[ph--user-circle] size-14"></i>
						</div>
					{/if}

					<div
						class="bg-base-100 relative -ml-6 flex min-w-0 w-fit max-w-[calc(100%-6.5rem)] flex-none flex-col items-start justify-center gap-3 rounded-box rounded-l-none px-5 py-4 pl-10 text-left sm:max-w-md "
					>
						<div class="flex w-full items-start justify-between gap-2">
							<div class="flex min-w-0 flex-col items-start gap-1">
								<h1 class="relative inline-block max-w-full wrap-break-word text-left text-xl font-bold tracking-tight">
									{profile.displayName}
								</h1>

								{#if profile.place?.name?.trim()}
									<a href={resolve(`/p/[slug]`, { slug: profile.place.slug })} class="text-base-content/60 flex min-w-0 items-center justify-start gap-1 text-sm">
										<i class="icon-[ph--map-pin] size-4" aria-hidden="true"></i>
										<span class="min-w-0 wrap-break-word">{profile.place.name}</span>
									</a>
								{/if}
							</div>
							{#if isOwnProfile}
								<a href={resolve(`/profile/public`)} class="btn btn-circle btn-sm" title="Profil bearbeiten">
									<i class="icon-[ph--pencil] size-4"></i>
								</a>
							{/if}
						</div>
					</div>
				</div>

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

				{#if profile.socialLinks.length}
					<div class="flex flex-col items-center gap-2 sm:hidden">
						{#each socialLinkRowsMobile as row, rowIndex (rowIndex)}
							<div class="flex justify-center gap-2">
								{#each row as link, i (`${link.type}-${rowIndex}-${i}`)}
									{@render socialLinkButton(link)}
								{/each}
							</div>
						{/each}
					</div>
					<div class="hidden sm:flex flex-col items-center gap-2">
						{#each socialLinkRowsDesktop as row, rowIndex (rowIndex)}
							<div class="flex justify-center gap-4">
								{#each row as link, i (`${link.type}-${rowIndex}-${i}`)}
									{@render socialLinkButton(link)}
								{/each}
							</div>
						{/each}
					</div>
				{/if}

				<div class=" gap-6 pt-0 sm:mx-4">
					{#if profile.bio?.trim()}
						<div class={["prose max-w-none", (profile.bio.length < 180) && `text-center`]}>
							{@html profile.bio}
						</div>
					{/if}
		
				</div>
			</div>
		</div>


	</div>

	<div class="mt-6 px-4 sm:px-0">
		<h2 class="mb-3 text-lg font-semibold pl-1">{profile.displayName}'s kommende Events</h2>
		{#if upcomingEvents?.length}
			<div class="flex w-full flex-col gap-6">
				{#each upcomingEvents as event (event.id)}
					<EventCard {event} />
				{/each}
			</div>
		{:else}
			<p class="text-base-content/60 text-sm">Aktuell keine kommenden Events.</p>
		{/if}
	</div>

	<div class="flex w-full justify-center gap-6 py-3">
		<a href={routes.eventList()} class="btn btn-sm">
			<i class="icon-[ph--arrow-left] mr-1 size-5"></i>
			Alle Events
		</a>
	</div>
</div>

<style>
	:global(.prose a) {
		text-decoration: underline;
	}

	:global(.prose p) {
		margin-bottom: 0.3rem ;
		margin-top: 0.3rem ;
	}
</style>
