<script lang="ts" module>
	let dismissed = $state(false);

	export function dismissAutoLocationHint() {
		dismissed = true;
	}
</script>

<script lang="ts">
	import { page } from '$app/state';
	import { setLocationInteractedCookie } from '$lib/cookie-utils';
	import { fly } from 'svelte/transition';

	const { autoDetectedCity } = $derived(page.data);
	const show = $derived(Boolean(autoDetectedCity) && !dismissed);

	function dismissWithCookie() {
		dismissed = true;
		setLocationInteractedCookie();
	}
</script>

{#if show && autoDetectedCity}
	<div
		transition:fly={{ y: 8, duration: 250 }}
		data-testid="auto-location-hint"
		role="status"
		class="absolute bottom-full left-1/2 z-60 mb-2.5 w-64 -translate-x-1/2 sm:w-72"
	>
		<div
			class="hint-nudge hint-nudge-up bg-primary text-primary-content rounded-box relative flex items-start gap-1 py-2 pr-1 pl-3 text-xs leading-snug font-medium shadow-lg"
		>
			<span class="pt-0.5">
				Dir werden Events um <b>{autoDetectedCity}</b> angezeigt. Wenn das nicht dein Standort ist, ändere ihn hier.
			</span>
			<button
				type="button"
				class="btn btn-ghost btn-circle btn-xs shrink-0 text-primary-content"
				aria-label="Hinweis schließen"
				data-testid="auto-location-hint-close"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					dismissWithCookie();
				}}
			>
				<i class="icon-[ph--x] size-3.5"></i>
			</button>
			<span class="bg-primary absolute -bottom-1 left-1/2 -ml-1.5 size-3 rotate-45"></span>
		</div>
	</div>
{/if}

<style>
	@media (prefers-reduced-motion: no-preference) {
		.hint-nudge-up {
			animation: nudge-up 2s ease-in-out 0.4s infinite;
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
</style>
