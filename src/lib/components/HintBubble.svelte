<script lang="ts">
	import { Popover } from "bits-ui";
	import { fly } from "svelte/transition";
	import type { Snippet } from "svelte";

	let { open, side = `top`, testId, closeTestId, class: className = ``, onDismiss, children }: Props = $props();

	// Bits UI Popover positions with Floating UI: it follows the anchor through scroll
	// and resize, flips when the preferred side would leave a scrollport or the viewport,
	// and hides once the anchor is fully clipped. Dismissal stays on the close button.
	let anchor = $state<HTMLElement | null>(null);
	let anchorVisible = $state(false);
	let collisionPadding = $state({ top: 12, right: 12, bottom: 12, left: 12 });
	let reduceMotion = $state(false);
	const collisionBoundary = $derived(anchor ? clippingAncestors(anchor) : []);

	function bindAnchor(node: HTMLElement) {
		const sync = () => {
			const next = node.parentElement;
			anchor = next;
			anchorVisible = !!next && isAnchorVisible(next);
			collisionPadding = readSafeAreaPadding();
		};
		sync();
		const motion = window.matchMedia(`(prefers-reduced-motion: reduce)`);
		const desktop = window.matchMedia(`(min-width: 768px)`);
		const syncMotion = () => {
			reduceMotion = motion.matches;
		};
		syncMotion();
		const observer = new MutationObserver(sync);
		let current = node.parentElement;
		while (current) {
			observer.observe(current, { attributes: true, attributeFilter: [`class`, `style`, `hidden`] });
			current = current.parentElement;
		}
		motion.addEventListener(`change`, syncMotion);
		desktop.addEventListener(`change`, sync);
		window.addEventListener(`resize`, sync);
		return () => {
			observer.disconnect();
			motion.removeEventListener(`change`, syncMotion);
			desktop.removeEventListener(`change`, sync);
			window.removeEventListener(`resize`, sync);
			anchor = null;
			anchorVisible = false;
		};
	}

	function dismiss(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		onDismiss();
	}

	function isAnchorVisible(node: HTMLElement) {
		if (typeof node.checkVisibility !== `function`) return node.getClientRects().length > 0;
		return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
	}

	function clippingAncestors(node: HTMLElement) {
		const ancestors: HTMLElement[] = [];
		let parent = node.parentElement;
		while (parent && parent !== document.documentElement) {
			const style = getComputedStyle(parent);
			const clips = [style.overflow, style.overflowX, style.overflowY].some(
				(value) => value === `auto` || value === `scroll` || value === `hidden` || value === `clip`,
			);
			if (clips) ancestors.push(parent);
			parent = parent.parentElement;
		}
		return ancestors;
	}

	function readSafeAreaPadding() {
		if (typeof document === `undefined`) return { top: 12, right: 12, bottom: 12, left: 12 };
		const probe = document.createElement(`div`);
		probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)`;
		document.body.append(probe);
		const style = getComputedStyle(probe);
		const padding = {
			top: Math.max(12, Number.parseFloat(style.paddingTop) || 0),
			right: Math.max(12, Number.parseFloat(style.paddingRight) || 0),
			bottom: Math.max(12, Number.parseFloat(style.paddingBottom) || 0),
			left: Math.max(12, Number.parseFloat(style.paddingLeft) || 0),
		};
		probe.remove();
		return padding;
	}

	type Props = {
		open: boolean;
		side?: `top` | `bottom`;
		testId: string;
		closeTestId: string;
		class?: string;
		onDismiss: () => void;
		children: Snippet;
	};
</script>

<span {@attach bindAnchor} hidden></span>

{#if open && anchor && anchorVisible}
	<Popover.Root open>
		<Popover.Portal>
			<Popover.Content
				customAnchor={anchor}
				{side}
				sideOffset={10}
				align="center"
				avoidCollisions
				{collisionPadding}
				{collisionBoundary}
				hideWhenDetached
				sticky="partial"
				strategy="fixed"
				trapFocus={false}
				preventScroll={false}
				escapeKeydownBehavior="defer-otherwise-ignore"
				interactOutsideBehavior="defer-otherwise-ignore"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				role="status"
				data-testid={testId}
				class={[`z-50 max-w-[calc(100vw-1.5rem)] outline-hidden`, className]}
			>
				<div
					class="hint-nudge bg-primary text-primary-content rounded-box relative flex items-start gap-1 py-2 pr-1 pl-3 text-xs leading-snug font-medium shadow-lg"
					transition:fly={{ y: side === `top` ? 8 : -8, duration: reduceMotion ? 0 : 250 }}
				>
					<span class="pt-0.5">
						{@render children()}
					</span>
					<button
						type="button"
						class="btn btn-ghost btn-circle btn-xs text-primary-content shrink-0"
						aria-label="Hinweis schließen"
						data-testid={closeTestId}
						onclick={dismiss}
					>
						<i class="icon-[ph--x] size-3.5"></i>
					</button>
					<span class="caret bg-primary" aria-hidden="true"></span>
				</div>
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}

<style>
	.caret {
		position: absolute;
		left: 50%;
		width: 0.75rem;
		height: 0.75rem;
		margin-left: -0.375rem;
		transform: rotate(45deg);
	}

	:global([data-side="top"]) .caret {
		top: auto;
		bottom: -0.25rem;
	}

	:global([data-side="bottom"]) .caret {
		top: -0.25rem;
		bottom: auto;
	}

	@media (prefers-reduced-motion: no-preference) {
		:global([data-side="top"]) .hint-nudge {
			animation: nudge-up 2s ease-in-out 0.4s infinite;
		}

		:global([data-side="bottom"]) .hint-nudge {
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
