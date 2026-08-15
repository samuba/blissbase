<script lang="ts">
	import type { ClassValue, SVGAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: Props = $props();

	type Props = { class?: ClassValue } & SVGAttributes<SVGSVGElement>;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 200 200"
	fill="none"
	role="img"
	class={['overflow-visible', className]}
	{...restProps}
>
	<circle
		cx="100"
		cy="100"
		r="82.390"
		fill="#ffffff"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="23.625"
	/>
	<circle class="ripple" cx="100" cy="100" r="12" fill="oklch(85.2% 0.199 91.936)" />
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="31"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="5"
	/>
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="52"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="5"
	/>
</svg>

<style>
	.ripple {
		transform-box: fill-box;
		transform-origin: center;
		animation: ripple 2s ease-out infinite;
	}

	circle.ripple:nth-of-type(3) {
		animation-delay: 0.16s;
	}

	circle.ripple:nth-of-type(4) {
		animation-delay: 0.32s;
	}

	@keyframes ripple {
		0%,
		100% {
			transform: scale(0.86);
			opacity: 0.35;
		}
		40% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ripple {
			animation: none;
		}
	}
</style>
