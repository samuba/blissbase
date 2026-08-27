<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import { isEventOrOfferingListPath, routes } from "$lib/routes";
	import { peekFooter } from "$lib/peekFooter.svelte";
	import { user } from "$lib/user.svelte";

	const SCROLL_THRESHOLD = 8;
	const TOP_REVEAL_Y = 24;
	const NON_TEXT_INPUT_TYPES = new Set([`button`, `checkbox`, `color`, `file`, `hidden`, `image`, `radio`, `range`, `reset`, `submit`]);

	let visible = $state(true);
	let keyboardInset = $state(0);
	let textEntryFocused = $state(false);
	let lastScrollY = 0;

	const canAutoHide = $derived(isEventOrOfferingListPath({ pathname: page.url.pathname, origin: page.url.origin }));
	const keyboardOpen = $derived(textEntryFocused && keyboardInset > 150);
	// Auto-hide on mobile events/offerings feeds; other routes keep the footer parked.
	const hidden = $derived(canAutoHide && (!visible || keyboardOpen));

	$effect(() => {
		peekFooter.shown = !hidden;
	});

	afterNavigate(({ to }) => {
		lastScrollY = window.scrollY;
		if (!to) return;
		if (isEventOrOfferingListPath({ pathname: to.url.pathname, origin: to.url.origin })) return;
		visible = true;
	});

	function createLinks() {
		return [
			{ label: /* @wc-include */ `Über`, href: routes.about(), testId: `footer-about` },
			{ label: /* @wc-include */ `FAQ`, href: routes.faq(), testId: `footer-faq` },
			{ label: /* @wc-include */ `Datenschutz`, href: routes.privacyPolicy(), testId: `footer-privacy-policy` },
			{ label: /* @wc-include */ `AGB`, href: routes.termsOfService(), testId: `footer-terms-of-service` },
			{ label: /* @wc-include */ `Admin`, href: routes.admin(), testId: `footer-admin` },
		];
	}

	const links = createLinks().filter((x) => (user.isAdmin ? true : x.href !== routes.admin()));

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
			keyboardInset = Math.max(0, window.innerHeight - visibleHeight - visualViewport.offsetTop);
		};

		visualViewport.addEventListener(`resize`, syncKeyboardInset);
		visualViewport.addEventListener(`scroll`, syncKeyboardInset, { passive: true });
		syncKeyboardInset();

		return () => {
			visualViewport.removeEventListener(`resize`, syncKeyboardInset);
			visualViewport.removeEventListener(`scroll`, syncKeyboardInset);
		};
	});
</script>

<svelte:window onscroll={handleScroll} />
<svelte:document onfocusin={handleFocusIn} onfocusout={() => (textEntryFocused = false)} />

<footer
	aria-label="Seitenlinks"
	class={[
		`border-base-300/70 bg-base-100/95 fixed inset-x-0 z-40 border-t backdrop-blur-sm`,
		`bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0`,
		`transition-transform duration-200 ease-out motion-reduce:transition-none`,
		hidden && `pointer-events-none translate-y-full md:pointer-events-auto md:translate-y-0`,
	]}
>
	<nav class="mx-auto flex min-h-7 max-w-5xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-1">
		{#each links as link, index (link.href)}
			{#if link.href !== routes.privacyPolicy() && link.href !== routes.termsOfService()}
				{#if index > 0}
					<span class="text-base-content/30" aria-hidden="true">·</span>
				{/if}
				<a href={link.href} data-testid={link.testId} class="link link-hover text-base-content/50 text-xs leading-none">
					{link.label}
				</a>
			{/if}
		{/each}
	</nav>
</footer>
