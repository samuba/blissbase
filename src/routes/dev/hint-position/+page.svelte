<script lang="ts">
	import { page } from "$app/state";
	import AutoLocationHintBubble from "#lib/components/AutoLocationHintBubble.svelte";
	import HintBubble from "#lib/components/HintBubble.svelte";
	import { offeringsNavHint } from "#lib/offeringsNavHint.svelte.ts";
	import { onMount } from "svelte";

	const only = $derived(page.url.searchParams.get(`only`));
	const shown = (name: string) => {
		if (only === `product`) return name === `location` || name === `offerings`;
		if (!only) return true;
		return only === name;
	};

	let topOpen = $state(true);
	let bottomOpen = $state(true);
	let scrollOpen = $state(true);
	let scrollBottomOpen = $state(true);
	let pageOpen = $state(true);

	onMount(() => {
		const name = new URL(window.location.href).searchParams.get(`only`);
		if (!name || name === `offerings` || name === `product`) offeringsNavHint.onHomeScroll(2200);
		return () => offeringsNavHint.leaveHome();
	});
</script>

<svelte:head>
	<title>Hinweis-Position</title>
</svelte:head>

<div class="fixed top-2 left-4 z-60 w-40" data-testid="top-anchor">
	<HintBubble
		open={topOpen && shown(`top`)}
		side="top"
		testId="top-hint"
		closeTestId="top-hint-close"
		class="w-44"
		onDismiss={() => (topOpen = false)}
	>
		Oben am Rand
	</HintBubble>
	<div class="bg-base-100 rounded-box border-base-300 border px-3 py-2 text-sm">Oberer Anker</div>
</div>

<div class="fixed bottom-2 left-4 z-60 w-40" data-testid="bottom-anchor">
	<HintBubble
		open={bottomOpen && shown(`bottom`)}
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
				open={scrollOpen && shown(`scroll`)}
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
				open={scrollBottomOpen && shown(`scroll-bottom`)}
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
		{#if shown(`location`)}
			<AutoLocationHintBubble />
		{/if}
		<div class="input">Berlin</div>
	</div>

	<button type="button" class="btn w-fit" data-testid="outside-button">Außerhalb</button>

	<div class="h-[50rem]"></div>

	<div data-testid="page-anchor" class="bg-base-100 rounded-box relative mx-auto h-12 w-48 border px-3 py-2">
		<HintBubble
			open={pageOpen && shown(`page`)}
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
