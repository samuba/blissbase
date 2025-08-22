<script lang="ts">
	import { Dialog, type DialogTriggerProps } from 'bits-ui';
	import type { Snippet } from 'svelte';

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

	function goToPrevious() {
		if (imageUrls.length <= 1) return;
		currentIndex = currentIndex > 0 ? currentIndex - 1 : imageUrls.length - 1;
	}

	function goToNext() {
		if (imageUrls.length <= 1) return;
		currentIndex = currentIndex < imageUrls.length - 1 ? currentIndex + 1 : 0;
	}

	/**
	 * Handle touch start for swipe gestures
	 */
	function handleTouchStart(event: TouchEvent) {
		touchStartX = event.touches[0].clientX;
		touchStartY = event.touches[0].clientY;
	}

	/**
	 * Handle touch end for swipe gestures
	 */
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
				if (diffX > 0) {
					// Swipe left - go to next image
					goToNext();
				} else {
					// Swipe right - go to previous image
					goToPrevious();
				}
			}
		}

		// Reset touch coordinates
		touchStartX = null;
		touchStartY = null;
	}

	/**
	 * Handle keyboard navigation
	 */
	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;

		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				goToPrevious();
				break;
			case 'ArrowRight':
				event.preventDefault();
				goToNext();
				break;
			case 'Escape':
				event.preventDefault();
				open = false;
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

	// allow zooming when image is visible
	$effect(() => {
		const viewport = document.querySelector('meta[name="viewport"]');
		if (open) {
			const prevContent = viewport?.getAttribute('content');
			const newContent = prevContent
				?.replace(', maximum-scale=1,', '')
				.replace('user-scalable=no', '')
				.trim();
			viewport?.setAttribute('content', newContent ?? '');
		} else if (!viewport?.getAttribute('content')?.includes('maximum-scale=1')) {
			const prevContent = viewport?.getAttribute('content');
			viewport?.setAttribute('content', `${prevContent}, maximum-scale=1, user-scalable=no`);
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger {...triggerProps}>
		{@render children()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/95" />
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center outline-none"
			onclick={() => (open = false)}
			onkeydown={handleKeydown}
			ontouchstart={handleTouchStart}
			ontouchend={handleTouchEnd}
			tabindex={-1}
		>
			<div class="relative max-h-full max-w-full" onclick={(e) => e.stopPropagation()}>
				{currentIndex}
				{#if imageUrls.length > 0}
					<img
						src={imageUrls[currentIndex]}
						{alt}
						class="max-h-full max-w-full object-contain select-none"
						draggable="false"
					/>
				{/if}

				{#if imageUrls.length > 1}
					<button
						onclick={goToPrevious}
						class="absolute top-1/2 flex w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-full border-none bg-black/30 py-3 pr-3 shadow-lg transition-colors duration-150 hover:bg-black/70 focus:outline-none"
						type="button"
						aria-label="Previous image"
					>
						<i class="icon-[ph--caret-left] size-6 text-white"></i>
					</button>

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
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
