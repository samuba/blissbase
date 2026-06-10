<script lang="ts">
	import { stripHtml, trimAllWhitespaces } from "$lib/common";
	import type { OfferingFormat } from "$lib/rpc/offerings.common";

	let {
		offering,
		onclick,
		showAuthor = true,
		class: className,
	}: {
		offering: OfferingCardOffering;
		onclick?: () => void;
		showAuthor?: boolean;
		class?: string;
	} = $props();

	const preview = $derived(trimAllWhitespaces(stripHtml(offering.descriptionHtml)) ?? ``);
	const imageUrl = $derived(offering.imageUrls?.[0]);

	type OfferingCardOffering = {
		id: number;
		title: string;
		descriptionHtml: string;
		format: OfferingFormat;
		imageUrls?: string[];
		profile: {
			displayName: string | null;
			profileImageUrl: string;
		};
	};
</script>

<button
	type="button"
	class={[
		`card bg-base-100 group h-full w-full cursor-pointer rounded-2xl text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md`,
		className,
	]}
	onclick={() => onclick?.()}
	data-offering-id={offering.id}
>
	<article class="flex h-full flex-col">
		<div class="flex min-w-0 flex-1 flex-col sm:flex-row">
			{#if imageUrl}
				<div
					class="bg-base-200 min-w-32 w-full overflow-hidden rounded-t-2xl sm:max-w-42 sm:min-w-42 sm:rounded-tr-none sm:rounded-bl-2xl"
				>
					<img
						src={imageUrl}
						alt=""
						class="h-full max-h-72 w-full object-cover transition-transform duration-300 group-hover:scale-105 sm:max-h-54"
					/>
				</div>
			{/if}

			<div class="card-body flex flex-col gap-4 p-5">
				<h3 class="card-title line-clamp-2 leading-snug tracking-tight">{offering.title}</h3>

				{#if preview}
					<p class="text-base-content/75 line-clamp-3 text-sm leading-relaxed">
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
					<span class="badge badge-ghost shrink-0">
						{offering.format === `online` ? `Online` : offering.format === `offline` ? `Vor Ort` : `Vor Ort & Online`}
					</span>
				</div>
			</div>
		</div>
	</article>
</button>
