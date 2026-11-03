<script lang="ts">
	import { localeStore } from '../../locales/localeStore.svelte';

	const options = [`en`, `de`] as const;
</script>

<div
	class="flex items-center gap-1 text-xs leading-none"
	data-testid="locale-switcher"
	role="group"
	aria-label="Sprache"
>
	{#each options as option, index (option)}
		{#if index > 0}
			<span class="text-base-content/30" aria-hidden="true">/</span>
		{/if}
		<button
			type="button"
			data-testid={`locale-${option}`}
			aria-pressed={localeStore.locale === option}
			class={[
				`link link-hover leading-none`,
				localeStore.locale === option ? `text-base-content` : `text-base-content/40`,
			]}
			onclick={() => localeStore.setLocale(option)}
		>
			{option}
		</button>
	{/each}
</div>
