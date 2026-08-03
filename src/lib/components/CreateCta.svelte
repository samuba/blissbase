<script lang="ts">
	import { page } from '$app/state';
	import { showLoginDialog } from '$lib/components/LoginDialog.svelte';
	import type { Attachment } from 'svelte/attachments';
	import { tick } from 'svelte';

	let {
		title,
		description,
		buttonText,
		href,
		requireLogin = false,
	}: {
		title: string;
		description: string;
		buttonText: string;
		href: string;
		requireLogin?: boolean;
	} = $props();

	const userId = $derived(page.data.userId);
	const useLink = $derived(!requireLogin || Boolean(userId));
	let showFab = $state(false);

	function setShowFab(next: boolean) {
		if (next === showFab) return;

		const canTransition =
			typeof document.startViewTransition === `function` &&
			!window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;

		if (!canTransition) {
			showFab = next;
			return;
		}

		document.documentElement.dataset.vt = `create-cta-fab`;
		const transition = document.startViewTransition(async () => {
			showFab = next;
			await tick();
		});
		transition.finished.finally(() => {
			delete document.documentElement.dataset.vt;
		});
	}

	const observeCtaForFab: Attachment = (element) => {
		if (!(element instanceof HTMLElement)) return;

		let intersectionObserver: IntersectionObserver | undefined;

		const syncFabVisibility = (entry: IntersectionObserverEntry) => {
			const rootTop = entry.rootBounds?.top ?? 0;
			setShowFab(entry.boundingClientRect.top < rootTop);
		};

		const connectObserver = () => {
			const headerHeight =
				document.getElementById(`header-controls`)?.getBoundingClientRect().height ?? 0;

			intersectionObserver?.disconnect();
			intersectionObserver = new IntersectionObserver(
				(entries) => {
					const entry = entries[0];
					if (!entry) return;
					syncFabVisibility(entry);
				},
				{ rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 1 },
			);
			intersectionObserver.observe(element);
		};

		connectObserver();

		const headerElement = document.getElementById(`header-controls`);
		const resizeObserver = new ResizeObserver(connectObserver);
		if (headerElement) {
			resizeObserver.observe(headerElement);
		}

		return () => {
			intersectionObserver?.disconnect();
			resizeObserver.disconnect();
		};
	};

	const fabClasses = [
		`btn btn-primary fixed right-4 z-40 shadow-lg`,
		`bottom-[calc(4.75rem+env(safe-area-inset-bottom))]`,
		`md:bottom-4`,
	];
</script>

<div
	class="border-primary rounded-box bg-primary/20 flex flex-wrap sm:flex-col items-center sm:items-start sm:justify-center justify-between gap-2 border-2 border-dashed p-4"
>
	<span class="sm:card-title font-semibold text-primary-content whitespace-nowrap">{title}</span>
	<p class="text-primary-content/80 hidden sm:block">
		{description}
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
			data-sveltekit-preload-data="hover"
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
			data-sveltekit-preload-data="hover"
			class={[fabClasses, `create-cta-vt`]}
		>
			<i class="icon-[ph--plus] size-5"></i>
			{buttonText}
		</a>
	{:else}
		<button type="button" onclick={showLoginDialog} class={[fabClasses, `create-cta-vt`]}>
			<i class="icon-[ph--plus] size-5"></i>
			{buttonText}
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
