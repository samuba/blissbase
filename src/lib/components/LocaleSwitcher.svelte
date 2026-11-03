<script lang="ts">
	import PopOver from './PopOver.svelte';
	import { localeStore } from '../../locales/localeStore.svelte';

	const options = [
		{ locale: `en` as const, label: `Englisch` },
		{ locale: `de` as const, label: `Deutsch` },
	];

	const currentLabel = $derived(
		options.find((option) => option.locale === localeStore.locale)?.label ?? `Englisch`,
	);
	let open = $state(false);
</script>

<PopOver
	bind:open
	contentClass="bg-base-100 z-50 min-w-28 p-1"
	contentProps={{ side: `top`, align: `start`, sideOffset: 8 }}
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			data-testid="locale-switcher"
			aria-label="Sprache"
			class={[
				`link link-hover text-base-content/50 inline-flex items-center gap-1 text-xs leading-none`,
				props.class,
			]}
		>
			<i class="icon-[ph--flag] size-3.5 shrink-0" aria-hidden="true"></i>
			{currentLabel}
		</button>
	{/snippet}

	{#snippet content()}
		<div class="flex flex-col gap-0.5" role="menu" aria-label="Sprache">
			{#each options as option (option.locale)}
				<button
					type="button"
					role="menuitemradio"
					data-testid={`locale-${option.locale}`}
					aria-checked={localeStore.locale === option.locale}
					class={[
						`btn btn-ghost btn-sm justify-start font-normal`,
						localeStore.locale === option.locale && `pointer-events-none opacity-55`,
					]}
					onclick={() => {
						open = false;
						localeStore.setLocale(option.locale);
					}}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/snippet}
</PopOver>
