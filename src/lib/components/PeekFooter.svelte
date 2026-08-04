<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { routes } from '$lib/routes';
	import { peekFooter } from '$lib/peekFooter.svelte';

	const SCROLL_THRESHOLD = 8;
	const TOP_REVEAL_Y = 24;
	const NON_TEXT_INPUT_TYPES = new Set([
		`button`,
		`checkbox`,
		`color`,
		`file`,
		`hidden`,
		`image`,
		`radio`,
		`range`,
		`reset`,
		`submit`
	]);

	let visible = $state(true);
	let keyboardInset = $state(0);
	let textEntryFocused = $state(false);
	let lastScrollY = 0;

	const canAutoHide = $derived(
		isFeedPath({ pathname: page.url.pathname, origin: page.url.origin })
	);
	const keyboardOpen = $derived(textEntryFocused && keyboardInset > 150);
	// Auto-hide on mobile events/offerings feeds; other routes keep the footer parked.
	const hidden = $derived(canAutoHide && (!visible || keyboardOpen));

	$effect(() => {
		peekFooter.shown = !hidden;
	});

	afterNavigate(({ to }) => {
		lastScrollY = window.scrollY;
		if (!to) return;
		if (isFeedPath({ pathname: to.url.pathname, origin: to.url.origin })) return;
		visible = true;
	});

	const links = [
		{ label: `Über`, href: routes.about() },
		{ label: `FAQ`, href: routes.faq() }
	] as const;

	function handleScroll() {
		if (!canAutoHide) return;

		const y = window.scrollY;
		const delta = y - lastScrollY;
		if (Math.abs(delta) < SCROLL_THRESHOLD) return;

		if (y < TOP_REVEAL_Y) {
			visible = true;
		} else if (delta > 0) {
			visible = false;
		} else {
			visible = true;
		}

		lastScrollY = y;
	}

	function isTextEntry(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
		if (!(target instanceof HTMLInputElement)) return false;
		return !NON_TEXT_INPUT_TYPES.has(target.type);
	}

	function handleFocusIn(event: FocusEvent) {
		textEntryFocused = isTextEntry(event.target);
	}

	onMount(() => {
		lastScrollY = window.scrollY;

		const visualViewport = window.visualViewport;
		if (!visualViewport) return;

		const syncKeyboardInset = () => {
			const visibleHeight = visualViewport.height * visualViewport.scale;
			keyboardInset = Math.max(
				0,
				window.innerHeight - visibleHeight - visualViewport.offsetTop
			);
		};

		visualViewport.addEventListener(`resize`, syncKeyboardInset);
		visualViewport.addEventListener(`scroll`, syncKeyboardInset, { passive: true });
		syncKeyboardInset();

		return () => {
			visualViewport.removeEventListener(`resize`, syncKeyboardInset);
			visualViewport.removeEventListener(`scroll`, syncKeyboardInset);
		};
	});

	function isFeedPath(args: { pathname: string; origin: string }) {
		const eventsPath = new URL(routes.root(), args.origin).pathname;
		const offeringsPath = new URL(routes.offeringsList(), args.origin).pathname;
		return args.pathname === eventsPath || args.pathname === offeringsPath;
	}
</script>

<svelte:window onscroll={handleScroll} />
<svelte:document onfocusin={handleFocusIn} onfocusout={() => (textEntryFocused = false)} />

<footer
	aria-label="Seitenlinks"
	class={[
		`fixed inset-x-0 z-40 border-t border-base-300/70 bg-base-100/95 backdrop-blur-sm`,
		`bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0`,
		`transition-transform duration-200 ease-out motion-reduce:transition-none`,
		hidden && `pointer-events-none translate-y-full md:pointer-events-auto md:translate-y-0`
	]}
>
	<nav class="mx-auto flex h-7 max-w-5xl items-center justify-center gap-2 px-3">
		{#each links as link, index (link.href)}
			{#if index > 0}
				<span class="text-base-content/30" aria-hidden="true">·</span>
			{/if}
			<a href={link.href} class="link link-hover text-xs leading-none text-base-content/50">
				{link.label}
			</a>
		{/each}
	</nav>
</footer>
