<script lang="ts">
	import { onMount } from "svelte";
	import { routes } from "#lib/routes.ts";
	import { peekFooter } from "#lib/peekFooter.svelte.ts";
	import { user } from "#lib/user.svelte.ts";
	import LocaleSwitcher from "#lib/components/LocaleSwitcher.svelte";
	import { showContactDialog } from "#lib/components/ContactBubble.svelte";

	const NON_TEXT_INPUT_TYPES = new Set([`button`, `checkbox`, `color`, `file`, `hidden`, `image`, `radio`, `range`, `reset`, `submit`]);

	let keyboardInset = $state(0);
	let textEntryFocused = $state(false);

	const keyboardOpen = $derived(textEntryFocused && keyboardInset > 150);
	const hidden = $derived(keyboardOpen);

	$effect(() => {
		peekFooter.shown = !hidden;
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
	const contactLabel = /* @wc-include */ `Kontakt`;

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
		<button
			type="button"
			data-testid="footer-contact"
			onclick={showContactDialog}
			class="link link-hover text-base-content/50 inline-flex items-center gap-1 text-xs leading-none md:hidden"
		>
			<i class="icon-[ph--chat-circle-dots] size-3.5 shrink-0" aria-hidden="true"></i>
			{contactLabel}
		</button>
		<span class="text-base-content/30 md:hidden" aria-hidden="true">·</span>
		<LocaleSwitcher forceClose={hidden} />
		<span class="text-base-content/30" aria-hidden="true">·</span>
		{#each links as link, index (link.href)}
			{@const hide = link.href === routes.privacyPolicy() || link.href === routes.termsOfService()}
			{#if index > 0 && !hide}
				<span class="text-base-content/30" aria-hidden="true">·</span>
			{/if}
			<a
				href={link.href}
				data-testid={link.testId}
				class="link link-hover text-base-content/50 text-xs leading-none {hide ? `hidden` : ``}"
			>
				{link.label}
			</a>
		{/each}
	</nav>
</footer>
