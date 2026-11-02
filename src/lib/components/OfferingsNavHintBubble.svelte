<script lang="ts">
	import { offeringsNavHint } from '$lib/offeringsNavHint.svelte';
	import { fly } from 'svelte/transition';

	let { placement }: { placement: `above` | `below` } = $props();
	const above = $derived(placement === `above`);
</script>

{#if offeringsNavHint.show}
	<div
		transition:fly={{ y: above ? 8 : -8, duration: 250 }}
		data-testid="offerings-nav-hint"
		role="status"
		class={[`absolute left-1/2 z-60 w-44 -translate-x-1/2`, above ? `bottom-full mb-2.5` : `top-full mt-1.5`]}
	>
		<div
			class={[
				`hint-nudge bg-primary text-primary-content rounded-box relative flex items-start gap-1 py-2 pr-1 pl-3 text-xs leading-snug font-medium shadow-lg`,
				above ? `hint-nudge-up` : `hint-nudge-down`
			]}
		>
			<span class="pt-0.5">Hier findest du 1:1 Sessions und Services</span>
			<button
				type="button"
				class="btn btn-ghost btn-circle btn-xs shrink-0 text-primary-content"
				aria-label="Hinweis schließen"
				data-testid="offerings-nav-hint-close"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					offeringsNavHint.dismiss();
				}}
			>
				<i class="icon-[ph--x] size-3.5"></i>
			</button>
			<!-- caret pointing at the tab -->
			<span
				class={[`bg-primary absolute left-1/2 -ml-1.5 size-3 rotate-45`, above ? `-bottom-1` : `-top-1`]}
			></span>
		</div>
	</div>
{/if}

<style>
	@media (prefers-reduced-motion: no-preference) {
		.hint-nudge-up {
			animation: nudge-up 2s ease-in-out 0.4s infinite;
		}
		.hint-nudge-down {
			animation: nudge-down 2s ease-in-out 0.4s infinite;
		}
	}

	@keyframes nudge-up {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-4px);
		}
	}

	@keyframes nudge-down {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(4px);
		}
	}
</style>
