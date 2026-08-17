<script lang="ts">
	import type { ClassValue, HTMLAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: Props = $props();

	const rings = [
		{ inner: `0%`, outer: `6.3%` },
		{ inner: `19.8%`, outer: `30%` },
		{ inner: `43.5%`, outer: `56.4%` },
		{ inner: `69.8%`, outer: `95.5%` }
	];

	type Props = { class?: ClassValue } & HTMLAttributes<HTMLDivElement>;
</script>

<div role="img" class={['relative overflow-visible', className]} {...restProps}>
	{#each rings as ring, i (ring.inner)}
		<img
			src="/logo-90x90.png"
			alt=""
			class={['ripple size-full object-contain', i !== 0 && `absolute inset-0`]}
			style:--inner={ring.inner}
			style:--outer={ring.outer}
			style:animation-delay={`${i * 0.28}s`}
		/>
	{/each}
</div>

<style>
	.ripple {
		transform-origin: center;
		animation: ripple 1.6s ease-in-out infinite;
		mask-image: radial-gradient(
			circle closest-side,
			transparent max(0%, calc(var(--inner) - 0.5%)),
			#fff var(--inner),
			#fff var(--outer),
			transparent calc(var(--outer) + 0.5%)
		);
		mask-mode: alpha;
		mask-repeat: no-repeat;
		mask-position: center;
		mask-size: 100% 100%;
		-webkit-mask-image: radial-gradient(
			circle closest-side,
			transparent max(0%, calc(var(--inner) - 0.5%)),
			#fff var(--inner),
			#fff var(--outer),
			transparent calc(var(--outer) + 0.5%)
		);
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
		-webkit-mask-size: 100% 100%;
	}

	@keyframes ripple {
		0%,
		100% {
			transform: scale(0.7);
			opacity: 0.2;
		}
		50% {
			transform: scale(1.18);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ripple {
			animation: none;
		}
	}
</style>
