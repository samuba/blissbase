<script lang="ts">
	import { Dialog } from '$lib/components/dialog';
	import type { DialogTriggerProps } from 'bits-ui';
	import type { Snippet } from 'svelte';

	const VIEWPORT_NO_ZOOM = `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no`;
	const VIEWPORT_ALLOW_ZOOM = `width=device-width, initial-scale=1, viewport-fit=cover`;

	let {
		imageUrls = [],
		alt,
		children,
		triggerProps,
		currentIndex = $bindable()
	}: {
		imageUrls?: string[];
		alt: string;
		children: Snippet;
		triggerProps?: DialogTriggerProps;
		currentIndex: number;
	} = $props();

	let open = $state(false);
	let touchStartX: number | null = null;
	let touchStartY: number | null = null;
	let lastSwipeAt = 0;

	function setViewportZoom(allowed: boolean) {
		const viewport = document.querySelector(`meta[name="viewport"]`);
		if (!viewport) return;

		// Replace the node — iOS often ignores content updates on the existing meta tag
		const next = document.createElement(`meta`);
		next.setAttribute(`name`, `viewport`);
		next.setAttribute(`content`, allowed ? VIEWPORT_ALLOW_ZOOM : VIEWPORT_NO_ZOOM);
		viewport.replaceWith(next);
	}

	function resetNativeZoom() {
		if (!open) return;
		setViewportZoom(false);
		// Briefly lock scale so iOS drops the pinch-zoom, then re-allow zoom
		setTimeout(() => {
			if (!open) return;
			setViewportZoom(true);
		}, 50);
	}

	function goToPrevious() {
		if (currentIndex <= 0) {
			onOpenChange(false);
			return;
		}
		currentIndex = currentIndex - 1;
		resetNativeZoom();
	}

	function goToNext() {
		if (currentIndex >= imageUrls.length - 1) {
			onOpenChange(false);
			return;
		}
		currentIndex = currentIndex + 1;
		resetNativeZoom();
	}

	function wasRecentSwipe() {
		return Date.now() - lastSwipeAt < 350;
	}

	function handleImageClick(event: MouseEvent) {
		event.stopPropagation();
		if (wasRecentSwipe()) return;

		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;

		const rect = target.getBoundingClientRect();
		const clickedLeft = event.clientX - rect.left < rect.width * 0.38;
		if (clickedLeft) {
			goToPrevious();
			return;
		}
		goToNext();
	}

	function handleBackdropClick() {
		if (wasRecentSwipe()) return;
		onOpenChange(false);
	}

	function onOpenChange(shouldOpen: boolean) {
		open = shouldOpen;
		setViewportZoom(shouldOpen);
	}

	function handleTouchStart(event: TouchEvent) {
		touchStartX = event.touches[0].clientX;
		touchStartY = event.touches[0].clientY;
	}

	function handleTouchEnd(event: TouchEvent) {
		if (touchStartX === null || touchStartY === null) return;

		const touchEndX = event.changedTouches[0].clientX;
		const touchEndY = event.changedTouches[0].clientY;

		const diffX = touchStartX - touchEndX;
		const diffY = touchStartY - touchEndY;

		// Only process horizontal swipes
		if (Math.abs(diffX) > Math.abs(diffY)) {
			const minSwipeDistance = 50; // minimum distance for a swipe

			if (Math.abs(diffX) > minSwipeDistance) {
				lastSwipeAt = Date.now();
				if (diffX > 0) {
					// Swipe left - go to next image
					goToNext();
				} else {
					// Swipe right - go to previous image
					goToPrevious();
				}
			}
		}

		touchStartX = null;
		touchStartY = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;

		// @wc-ignore
		switch (event.key)  {
			case `ArrowLeft`:
				event.preventDefault();
				goToPrevious();
				break;
			case `ArrowRight`:
				event.preventDefault();
				goToNext();
				break;
			case `Escape`:
				event.preventDefault();
				onOpenChange(false);
				break;
		}
	}

	// Ensure currentIndex stays within bounds when imageUrls changes
	$effect(() => {
		if (currentIndex >= imageUrls.length && imageUrls.length > 0) {
			currentIndex = imageUrls.length - 1;
		} else if (imageUrls.length === 0) {
			currentIndex = 0;
		}
	});
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Trigger {...triggerProps}>
		{@render children()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.OverlayAnimated class="z-70!" />
		<Dialog.ContentAnimated
			class="fixed inset-0 z-70 flex items-center justify-center outline-none"
			onclick={handleBackdropClick}
			onkeydown={handleKeydown}
			ontouchstart={handleTouchStart}
			ontouchend={handleTouchEnd}
			tabindex={-1}
		>
			<div
				class="relative max-h-full max-w-full"
				role="presentation"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				{#if imageUrls.length > 0}
					<button
						type="button"
						class="block max-h-full max-w-full cursor-pointer border-none bg-transparent p-0"
						onclick={handleImageClick}
						aria-label={
							imageUrls.length > 1
								? `Image ${currentIndex + 1} of ${imageUrls.length}`
								: `Close image`
						}
					>
						<img
							src={imageUrls[currentIndex]}
							{alt}
							class="max-h-[100vh] max-w-full object-contain select-none"
							draggable="false"
						/>
					</button>
				{/if}

				{#if currentIndex > 0}
					<button
						onclick={goToPrevious}
						class="absolute top-1/2 flex w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-full border-none bg-black/30 py-3 pr-3 shadow-lg transition-colors duration-150 hover:bg-black/70 focus:outline-none"
						type="button"
						aria-label="Previous image"
					>
						<i class="icon-[ph--caret-left] size-6 text-white"></i>
					</button>
				{/if}

				{#if currentIndex < imageUrls.length - 1}
					<button
						onclick={goToNext}
						class="absolute top-1/2 right-0 flex w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-full border-none bg-black/30 py-3 pl-3 shadow-lg transition-colors duration-150 hover:bg-black/70 focus:outline-none"
						type="button"
						aria-label="Next image"
					>
						<i class="icon-[ph--caret-right] size-6 text-white"></i>
					</button>
				{/if}
			</div>

			<Dialog.Close class="btn btn-circle absolute top-4 right-4 shadow-lg">
				<i class="icon-[ph--x] size-5"></i>
				<span class="sr-only">Close</span>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
