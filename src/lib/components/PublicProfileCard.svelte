<script lang="ts">
	import { resolve } from "$app/paths";
	import { stripHtml, trimAllWhitespaces } from "$lib/common";
	import type { Profile } from "$lib/server/schema";
	import type { Snippet } from "svelte";

	let { profile, children, class: className }: { profile: Simplify<Pick<Profile, "slug" | "displayName" | "bio" | "profileImageUrl">>; children?: Snippet; class?: string } =
		$props();

	const bioPreview = $derived(profile.bio ? trimAllWhitespaces(stripHtml(profile.bio)) : undefined);
</script>

<a
	href={resolve(`/@/[slug]`, { slug: profile.slug! })}
	class={[
		`group bg-base-200 hover:bg-base-200/80 border-base-200 flex flex-col gap-3 rounded-2xl border p-3 transition-colors`,
		`no-underline`,
		className,
	]}
>
	<div class="flex w-full flex-row items-center gap-3">
		{#if profile.profileImageUrl}
			<img src={profile.profileImageUrl} alt="" class="border-base-300 size-16 shrink-0 rounded-full border border-2 object-cover" />
		{:else}
			<div class={[`bg-primary/15 text-primary border-base-300 flex size-12 shrink-0 items-center justify-center rounded-full border`]}>
				<i class="icon-[ph--user-circle] size-8"></i>
			</div>
		{/if}

		<div class="min-w-0 flex-1 text-left">
			<p class="text-base-content text-lg leading-tight font-semibold">{profile.displayName}</p>
			{#if bioPreview}
				<div class="relative mt-0.5">
					<p class={[`text-base-content/70 line-clamp-3 sm:line-clamp-2 text-sm leading-snug`]}>
						{bioPreview}
					</p>
				</div>
			{/if}
		</div>
		<i class="icon-[ph--caret-right] text-base-content size-5 shrink-0"></i>
	</div>
	{@render children?.()}
</a>
