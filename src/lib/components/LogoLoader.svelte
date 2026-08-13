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
	<circle cx="100" cy="100" r="82.390" fill="#ffffff" />
	<circle class="ripple" cx="100" cy="100" r="9.884" fill="oklch(85.2% 0.199 91.936)" />
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="27.304"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="2.411"
	/>
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="42.340"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="2.589"
	/>
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="57.620"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="2.531"
	/>
	<circle
		class="ripple"
		cx="100"
		cy="100"
		r="82.390"
		stroke="oklch(85.2% 0.199 91.936)"
		stroke-width="23.625"
	/>
</svg>

<style>
	.ripple {
		transform-box: fill-box;
		transform-origin: center;
		animation: ripple 2s ease-out infinite;
	}

	circle.ripple:nth-of-type(3) {
		animation-delay: 0.12s;
	}

	circle.ripple:nth-of-type(4) {
		animation-delay: 0.24s;
	}

	circle.ripple:nth-of-type(5) {
		animation-delay: 0.36s;
	}

	circle.ripple:nth-of-type(6) {
		animation-delay: 0.48s;
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
