<script lang="ts">
	import { localeStore } from '../../locales/localeStore.svelte';

	const options = [
		{ locale: `en` as const, label: `Englisch` },
		{ locale: `de` as const, label: `Deutsch` },
	];
</script>

<div
	class="flex items-center gap-1 text-xs leading-none"
	data-testid="locale-switcher"
	role="group"
	aria-label="Sprache"
>
	<i class="icon-[ph--flag] text-base-content/50 size-3.5 shrink-0" aria-hidden="true"></i>
	{#each options as option, index (option.locale)}
		{#if index > 0}
			<span class="text-base-content/30" aria-hidden="true">/</span>
		{/if}
		<button
			type="button"
			data-testid={`locale-${option.locale}`}
			aria-pressed={localeStore.locale === option.locale}
			class={[
				`link link-hover leading-none`,
				localeStore.locale === option.locale ? `text-base-content` : `text-base-content/40`,
			]}
			onclick={() => localeStore.setLocale(option.locale)}
		>
			{option.label}
		</button>
	{/each}
</div>
