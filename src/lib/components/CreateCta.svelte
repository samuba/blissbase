<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { showLoginDialog } from '$lib/components/LoginDialog.svelte';
	import { peekFooter } from '$lib/peekFooter.svelte';
	import type { Attachment } from 'svelte/attachments';
	import { tick, type Snippet } from 'svelte';

	let {
		title,
		description,
		buttonText,
		href,
		requireLogin = false,
	}: {
		title: Snippet;
		description: Snippet;
		buttonText: string;
		href: string;
		requireLogin?: boolean;
	} = $props();

	const userId = $derived(page.data.userId);
	const useLink = $derived(!requireLogin || Boolean(userId));
	let showFab = $state(false);
	let desiredShowFab = false;
	let fabTransitioning = false;
	let fabArmed = false;
	let ctaElement: HTMLElement | undefined;

	// Drop the fixed FAB instantly on leave so it can't morph/jump during
	// scroll-to-top of the outgoing page or briefly linger on the next route.
	beforeNavigate(({ from, to }) => {
		if (!from || !to) return;
		if (from.url.pathname === to.url.pathname) return;

		fabArmed = false;
		desiredShowFab = false;
		showFab = false;
		fabTransitioning = false;
		delete document.documentElement.dataset.vt;
	});

	function isRoughlyInViewport(element: HTMLElement) {
		const rect = element.getBoundingClientRect();
		return rect.bottom > 0 && rect.top < window.innerHeight;
	}

	function setShowFab(next: boolean) {
		desiredShowFab = next;
		applyShowFab();
	}

	function applyShowFab() {
		if (!fabArmed) return;
		if (fabTransitioning) return;
		if (desiredShowFab === showFab) return;

		const next = desiredShowFab;
		const canTransition =
			typeof document.startViewTransition === `function` &&
			!window.matchMedia(`(prefers-reduced-motion: reduce)`).matches &&
			// Skip morph when the in-flow button isn't on screen (e.g. back-nav scroll restore).
			(!ctaElement || isRoughlyInViewport(ctaElement));

		if (!canTransition) {
			showFab = next;
			return;
		}

		fabTransitioning = true;
		document.documentElement.dataset.vt = `create-cta-fab`;
		const transition = document.startViewTransition(async () => {
			showFab = next;
			await tick();
		});
		transition.finished.finally(() => {
			fabTransitioning = false;
			delete document.documentElement.dataset.vt;
			applyShowFab();
		});
	}

	function syncFabFromGeometry(element = ctaElement) {
		if (!element) return;

		const headerHeight =
			document.getElementById(`header-controls`)?.getBoundingClientRect().height ?? 0;
		setShowFab(element.getBoundingClientRect().top < headerHeight);
	}

	const observeCtaForFab: Attachment = (element) => {
		if (!(element instanceof HTMLElement)) return;

		ctaElement = element;
		fabArmed = false;
		let intersectionObserver: IntersectionObserver | undefined;
		let syncScheduled = false;
		let settleTimer: ReturnType<typeof setTimeout> | undefined;

		// Coalesce IO/scroll/resize onto one live geometry read after layout.
		// Avoids stale boundingClientRect from scroll restoration races.
		const scheduleSync = () => {
			if (syncScheduled) return;
			syncScheduled = true;
			requestAnimationFrame(() => {
				syncScheduled = false;
				syncFabFromGeometry(element);
			});
		};

		// Wait out SvelteKit scroll-to-top / back-forward restore before showing the FAB.
		// Otherwise a mid-nav scroll offset briefly treats the CTA as off-screen and the
		// previous page's FAB appears to "carry over", then morphs away when scroll settles.
		const armFab = () => {
			if (fabArmed) return;
			fabArmed = true;
			scheduleSync();
		};

		const scheduleArm = () => {
			clearTimeout(settleTimer);
			settleTimer = setTimeout(armFab, 50);
		};

		const connectObserver = () => {
			const headerHeight =
				document.getElementById(`header-controls`)?.getBoundingClientRect().height ?? 0;

			intersectionObserver?.disconnect();
			intersectionObserver = new IntersectionObserver(scheduleSync, {
				rootMargin: `-${headerHeight}px 0px 0px 0px`,
				threshold: 1,
			});
			intersectionObserver.observe(element);
			if (fabArmed) scheduleSync();
		};

		connectObserver();
		window.addEventListener(`scroll`, scheduleSync, { passive: true });
		window.addEventListener(`scroll`, scheduleArm, { passive: true });

		const headerElement = document.getElementById(`header-controls`);
		const resizeObserver = new ResizeObserver(connectObserver);
		if (headerElement) {
			resizeObserver.observe(headerElement);
		}

		// Arm after layout even when navigation does not emit scroll events.
		requestAnimationFrame(() => {
			requestAnimationFrame(scheduleArm);
		});

		return () => {
			if (ctaElement === element) ctaElement = undefined;
			fabArmed = false;
			clearTimeout(settleTimer);
			intersectionObserver?.disconnect();
			resizeObserver.disconnect();
			window.removeEventListener(`scroll`, scheduleSync);
			window.removeEventListener(`scroll`, scheduleArm);
		};
	};

	// Parked above tab + peek footer; on mobile slides down with the footer via the same transform.
	const fabClasses = $derived([
		`btn max-sm:btn-lg btn-primary max-sm:btn-circle fixed right-4 z-40 shadow-lg`,
		`bottom-[calc(6.5rem+env(safe-area-inset-bottom))] md:bottom-11`,
		`transition-transform duration-200 ease-out motion-reduce:transition-none`,
		!peekFooter.shown && `translate-y-[1.75rem] md:translate-y-0`
	]);
</script>

<div
	class="border-primary rounded-box bg-primary/20 flex flex-wrap sm:flex-col items-center sm:items-start sm:justify-center justify-between gap-2 border-2 border-dashed p-4"
>
	<span class="sm:card-title flex items-center gap-1.5 font-semibold text-primary-content whitespace-nowrap">
		{@render title()}
	</span>
	<p class="text-primary-content/80 hidden sm:block">
		{@render description()}
	</p>
	{#if useLink}
		<a
			{@attach observeCtaForFab}
			href={href}
			class={[
				`btn btn-primary w-fit`,
				!showFab && `create-cta-vt`,
				showFab && `invisible`,
			]}
			inert={showFab}
		>
			<i class="icon-[ph--plus] size-5"></i>
			{buttonText}
		</a>
	{:else}
		<button
			{@attach observeCtaForFab}
			type="button"
			onclick={showLoginDialog}
			class={[
				`btn btn-primary w-fit`,
				!showFab && `create-cta-vt`,
				showFab && `invisible`,
			]}
			inert={showFab}
		>
			<i class="icon-[ph--plus] size-5"></i>
			{buttonText}
		</button>
	{/if}
</div>

{#if showFab}
	{#if useLink}
		<a
			href={href}
			class={[fabClasses, `create-cta-vt`]}
			aria-label={buttonText}
		>
			<i class="icon-[ph--plus] size-6 sm:size-5"></i>
			<span class="hidden sm:block">{buttonText}</span>
		</a>
	{:else}
		<button
			type="button"
			onclick={showLoginDialog}
			class={[fabClasses, `create-cta-vt`]}
			aria-label={buttonText}
		>
			<i class="icon-[ph--plus] size-6 sm:size-5"></i>
			<span class="hidden sm:block">{buttonText}</span>
		</button>
	{/if}
{/if}

<style>
	.create-cta-vt {
		view-transition-name: create-cta;
	}

	:global(::view-transition-group(create-cta)) {
		animation-duration: 0.4s;
		animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* Keep the rest of the page still — only morph the create button. */
	:global(html[data-vt='create-cta-fab']::view-transition-old(root)),
	:global(html[data-vt='create-cta-fab']::view-transition-new(root)) {
		animation: none;
	}
</style>
