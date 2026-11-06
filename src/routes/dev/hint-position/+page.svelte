<script lang="ts">
	import AutoLocationHintBubble from "$lib/components/AutoLocationHintBubble.svelte";
	import HintBubble from "$lib/components/HintBubble.svelte";
	import { offeringsNavHint } from "$lib/offeringsNavHint.svelte";
	import { onMount } from "svelte";

	let topOpen = $state(true);
	let bottomOpen = $state(true);
	let scrollOpen = $state(true);
	let scrollBottomOpen = $state(true);
	let pageOpen = $state(true);

	onMount(() => {
		offeringsNavHint.onHomeScroll(2200);
		return () => offeringsNavHint.leaveHome();
	});
</script>

<svelte:head>
	<title>Hinweis-Position</title>
</svelte:head>

<div class="fixed top-2 left-4 z-60 w-40" data-testid="top-anchor">
	<HintBubble open={topOpen} side="top" testId="top-hint" closeTestId="top-hint-close" class="w-44" onDismiss={() => (topOpen = false)}>
		Oben am Rand
	</HintBubble>
	<div class="bg-base-100 rounded-box border-base-300 border px-3 py-2 text-sm">Oberer Anker</div>
</div>

<div class="fixed bottom-2 left-4 z-60 w-40" data-testid="bottom-anchor">
	<HintBubble
		open={bottomOpen}
		side="bottom"
		testId="bottom-hint"
		closeTestId="bottom-hint-close"
		class="w-44"
		onDismiss={() => (bottomOpen = false)}
	>
		Unten am Rand
	</HintBubble>
	<div class="bg-base-100 rounded-box border-base-300 border px-3 py-2 text-sm">Unterer Anker</div>
</div>

<div class="mx-auto flex w-full max-w-md flex-col gap-8 px-4 pt-24 pb-32">
	<div data-testid="scroll-box" class="border-base-300 rounded-box h-72 transform-gpu overflow-y-auto border">
		<div class="h-[25rem]"></div>
		<div data-testid="scroll-anchor" class="bg-base-100 rounded-box relative mx-8 h-12 border px-3 py-2">
			<HintBubble
				open={scrollOpen}
				side="top"
				testId="scroll-hint"
				closeTestId="scroll-hint-close"
				class="w-44"
				onDismiss={() => (scrollOpen = false)}
			>
				Im Scrollbereich
			</HintBubble>
			Scroll-Anker
		</div>
		<div class="h-[25rem]"></div>
		<div data-testid="scroll-bottom-anchor" class="bg-base-100 rounded-box relative mx-8 h-12 border px-3 py-2">
			<HintBubble
				open={scrollBottomOpen}
				side="bottom"
				testId="scroll-bottom-hint"
				closeTestId="scroll-bottom-hint-close"
				class="w-44"
				onDismiss={() => (scrollBottomOpen = false)}
			>
				Unten im Scrollbereich
			</HintBubble>
			Unterer Scroll-Anker
		</div>
		<div class="h-2"></div>
	</div>

	<div class="relative z-60 w-72" data-testid="location-anchor">
		<AutoLocationHintBubble />
		<div class="input">Berlin</div>
	</div>

	<button type="button" class="btn w-fit" data-testid="outside-button">Außerhalb</button>

	<div class="h-[50rem]"></div>

	<div data-testid="page-anchor" class="bg-base-100 rounded-box relative mx-auto h-12 w-48 border px-3 py-2">
		<HintBubble
			open={pageOpen}
			side="top"
			testId="page-hint"
			closeTestId="page-hint-close"
			class="w-44"
			onDismiss={() => (pageOpen = false)}
		>
			Folgt der Seite
		</HintBubble>
		Seiten-Anker
	</div>

	<div class="h-[40rem]"></div>
</div>
