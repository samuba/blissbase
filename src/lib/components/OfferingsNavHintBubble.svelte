<script lang="ts">
	import HintBubble from "#lib/components/HintBubble.svelte";
	import { offeringsNavHint } from "#lib/offeringsNavHint.svelte.ts";

	let { side }: { side: `top` | `bottom` } = $props();
</script>

<HintBubble
	open={offeringsNavHint.show}
	{side}
	testId="offerings-nav-hint"
	closeTestId="offerings-nav-hint-close"
	class="w-44"
	onDismiss={() => offeringsNavHint.dismiss()}
>
	Hier findest du 1:1 Sessions und Services
</HintBubble>
