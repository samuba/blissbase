<script lang="ts">
	import type { OfferingFormat } from "$lib/rpc/offerings.common";
	import { routes } from "$lib/routes";

	let {
		offering,
		onclick,
		showAuthor = true,
		returnTo,
		class: className,
	}: {
		offering: OfferingCardOffering;
		onclick?: () => void;
		showAuthor?: boolean;
		returnTo?: string | null;
		class?: string;
	} = $props();

	const preview = $derived(htmlToPreviewText(offering.descriptionHtml));
	const imageUrl = $derived(offering.imageUrls?.[0]);
	const isDisabled = $derived(offering.listed === false);
	const href = $derived(
		offering.slug ? routes.offeringDetails(offering.slug, { returnTo }) : routes.offeringsList(),
	);

	function handleClick(event: MouseEvent) {
		if (!onclick) return;
		if (!offering.slug) return;
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		onclick();
	}

	function htmlToPreviewText(html: string | undefined) {
		if (!html) return ``;
		return html
			.replace(/<br\s*\/?>/gi, `\n`)
			.replace(/<\/p>/gi, `\n`)
			.replace(/<[^>]*>?/g, ``)
			.replace(/&nbsp;/gi, ` `)
			.replace(/[^\S\n]+/g, ` `)
			.trim();
	}

	type OfferingCardOffering = {
		id: number;
		slug: string | null;
		title: string;
		descriptionHtml: string;
		format: OfferingFormat;
		imageUrls?: string[];
		listed?: boolean;
		profile: {
			displayName: string | null;
			profileImageUrl: string;
		};
	};
</script>

<a
	{href}
	class={[
		`card bg-base-100 group h-full w-full cursor-pointer rounded-2xl text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md`,
		isDisabled && `opacity-75`,
		className,
	]}
	data-sveltekit-preload-data="false"
	onclick={handleClick}
	data-offering-id={offering.id}
>
	<article class="flex h-full flex-col">
		<div class="flex min-w-0 flex-1 flex-col sm:flex-row">
			{#if imageUrl}
				<div
					class={[
						`from-base-200/50 to-base-300 relative min-w-32 bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-tr-none sm:rounded-bl-lg`,
						`rounded-t-lg sm:rounded-tl-lg`,
						isDisabled && `grayscale`,
					]}
				>
					<div class={[`h-full bg-cover bg-center`, `rounded-t-lg sm:rounded-tl-lg`]} style="background-image: url({imageUrl})">
						<figure
							class={[
								`h-full backdrop-blur-md backdrop-brightness-85 sm:rounded-tr-none sm:rounded-bl-lg`,
								`rounded-t-lg sm:rounded-tl-lg`,
							]}
						>
							<img
								src={imageUrl}
								alt="illustration for offering: {offering.title}"
								class="h-full max-h-72 max-w-full object-cover"
							/>
						</figure>
					</div>
				</div>
			{/if}

			<div class="card-body flex min-w-0 flex-col gap-4 p-5">
				<h3 class="card-title line-clamp-2 overflow-hidden leading-snug tracking-tight wrap-break-word">
					{offering.title}
				</h3>
				{#if isDisabled}
					<span class="badge badge-soft badge-warning w-fit gap-1">
						<i class="icon-[ph--eye-slash] size-3.5"></i>
						Deaktiviert — nicht für andere sichtbar
					</span>
				{/if}

				{#if preview}
					<p class="text-base-content/75 line-clamp-3 overflow-hidden text-sm leading-relaxed whitespace-pre-line wrap-break-word">
						{preview}
					</p>
				{/if}

				<div class={[`mt-auto flex items-center gap-3 pt-2`, showAuthor ? `justify-between` : `justify-start`]}>
					{#if showAuthor}
						<div class="flex min-w-0 items-center gap-2">
							{#if offering.profile.profileImageUrl}
								<img src={offering.profile.profileImageUrl} alt="" class="bg-base-200 size-9 shrink-0 rounded-full object-cover" />
							{:else}
								<div class="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
									<i class="icon-[ph--user-circle] size-5"></i>
								</div>
							{/if}
							<span class="text-base-content/80 min-w-0 truncate text-sm font-medium">
								{offering.profile.displayName ?? `Blissbase`}
							</span>
						</div>
					{/if}
					<span class="badge badge-ghost flex items-center gap-1.5 shrink-0 leading-none">
						{#if offering.format === `online`}
							<i class="icon-[ph--globe] size-4.5"></i>
							Online
						{:else if offering.format === `offline`}
							<i class="icon-[ph--users] size-4.5"></i>
							Vor Ort
						{:else}
							<i class="icon-[ph--users] size-4.5"></i>
							Vor Ort / Online
						{/if}
					</span>
				</div>
			</div>
		</div>
	</article>
</a>
