<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Profile } from '$lib/server/schema';

	let { profile }: { profile: Simplify<Pick<Profile, 'slug' | 'displayName' | 'bio' | 'profileImageUrl'>> } = $props();
</script>

<hr class="border-base-content/10 border-b border my-2">

<a
	href={resolve(`/@/[slug]`, { slug: profile.slug! })}
	class={[
		`bg-base-200 hover:bg-base-200/80 border-base-200 flex w-full flex-row items-center gap-3 rounded-2xl border p-3 transition-colors`,
		`no-underline`
	]}
>
	{#if profile.profileImageUrl}
		<img
			src={profile.profileImageUrl}
			alt=""
			class="border-base-300 size-16 shrink-0 rounded-full border-2 border object-cover"
		/>
	{:else}
		<div
			class={[
				`bg-primary/15 text-primary border-base-300 flex size-12 shrink-0 items-center justify-center rounded-full border`
			]}
		>
			<i class="icon-[ph--user-circle] size-8"></i>
		</div>
	{/if}
	<div class="min-w-0 flex-1 text-left">
		<p class="text-base-content font-semibold leading-tight text-lg">{profile.displayName}</p>
		{#if profile.bio}
			<p class="text-base-content/70 mt-0.5 line-clamp-2 text-sm leading-snug">
				{profile.bio}
			</p>
		{/if}
	</div>
	<i class="icon-[ph--caret-right] text-base-content/50 size-5 shrink-0"></i>
</a>
