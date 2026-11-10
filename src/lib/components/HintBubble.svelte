<script lang="ts" module>
	import { untrack } from "svelte";

	export const HINT_COOLDOWN_MS = 4 * 60 * 1000;

	class HintSlot {
		holders = $state<number[]>([]);
		coolingDown = $state(false);
		#next = 0;
		#timer: ReturnType<typeof setTimeout> | null = null;

		createId() {
			this.#next += 1;
			return this.#next;
		}

		setWanted(id: number, wanted: boolean) {
			const current = untrack(() => this.holders);
			const index = current.indexOf(id);
			if (wanted && index === -1) {
				this.holders.push(id);
				return;
			}
			if (!wanted && index !== -1) this.holders.splice(index, 1);
		}

		shows(id: number) {
			return !this.coolingDown && this.holders[0] === id;
		}

		startCooldown() {
			this.coolingDown = true;
			if (this.#timer) clearTimeout(this.#timer);
			this.#timer = setTimeout(() => {
				this.coolingDown = false;
				this.#timer = null;
			}, HINT_COOLDOWN_MS);
		}
	}

	const hintSlot = new HintSlot();

	export function startHintCooldown() {
		hintSlot.startCooldown();
	}
</script>

<script lang="ts">
	import { Popover } from "bits-ui";
	import { fly } from "svelte/transition";
	import type { Snippet } from "svelte";

	let { open, side = `top`, testId, closeTestId, class: className = ``, onDismiss, children }: Props = $props();
	const id = hintSlot.createId();

	// Popover already follows the anchor, flips, and hides it once the anchor is clipped.
	// Its default collision boundary is the viewport, and a portaled bubble is not inside
	// the anchor's scroll container, so that container has to be passed in.
	// strategy fixed is required: without a scroll lock the popover defaults to absolute,
	// so the bubble rides the page and snaps back when the async position update lands.
	// checkVisibility is separate: `hidden` / `invisible` anchors still have a box, and both
	// navs stay mounted, so the hidden one must not portal a second bubble.
	let anchor = $state<HTMLElement | null>(null);
	let anchorVisible = $state(false);
	const collisionBoundary = $derived(anchor ? clippingAncestors(anchor) : []);
	const wantsOpen = $derived(open && !!anchor && anchorVisible);
	const showing = $derived(wantsOpen && hintSlot.shows(id));

	// One bubble at a time. The first one that wants the screen keeps it until it closes.
	$effect(() => {
		hintSlot.setWanted(id, wantsOpen);
	});

	$effect(() => {
		return () => hintSlot.setWanted(id, false);
	});

	function bindAnchor(node: HTMLElement) {
		const sync = () => {
			const next = node.parentElement;
			anchor = next;
			anchorVisible = !!next && next.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
		};
		sync();
		const desktop = window.matchMedia(`(min-width: 768px)`);
		const observer = new MutationObserver(sync);
		let current = node.parentElement;
		while (current) {
			observer.observe(current, { attributes: true, attributeFilter: [`class`, `style`, `hidden`] });
			current = current.parentElement;
		}
		desktop.addEventListener(`change`, sync);
		return () => {
			observer.disconnect();
			desktop.removeEventListener(`change`, sync);
			anchor = null;
			anchorVisible = false;
		};
	}

	function dismiss(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		hintSlot.startCooldown();
		onDismiss();
	}

	function clippingAncestors(node: HTMLElement) {
		const ancestors: HTMLElement[] = [];
		let parent = node.parentElement;
		while (parent && parent !== document.documentElement) {
			const { overflow, overflowX, overflowY } = getComputedStyle(parent);
			const clips = [overflow, overflowX, overflowY].some(
				(value) => value === `auto` || value === `scroll` || value === `hidden` || value === `clip`,
			);
			if (clips) ancestors.push(parent);
			parent = parent.parentElement;
		}
		return ancestors;
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

{#if showing}
	<Popover.Root open>
		<Popover.Portal>
			<Popover.Content
				customAnchor={anchor}
				{side}
				sideOffset={10}
				collisionPadding={12}
				{collisionBoundary}
				hideWhenDetached
				strategy="fixed"
				trapFocus={false}
				escapeKeydownBehavior="defer-otherwise-ignore"
				interactOutsideBehavior="defer-otherwise-ignore"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				role="status"
				data-testid={testId}
				class={[`z-50 max-w-[calc(100vw-1.5rem)] outline-hidden`, className]}
			>
				<div
					class="hint-nudge bg-primary text-primary-content rounded-box relative py-2 pr-4 pl-3 text-xs leading-snug font-medium shadow-lg"
					transition:fly={{ y: side === `top` ? 8 : -8, duration: 250 }}
				>
					<span class="pt-0.5">
						{@render children()}
					</span>
					<button
						type="button"
						class="btn btn-ghost btn-circle btn-xs text-primary-content absolute top-0.5 right-0.5"
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
