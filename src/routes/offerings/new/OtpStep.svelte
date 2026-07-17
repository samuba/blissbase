<script lang="ts">
	import { PinInput, REGEXP_ONLY_DIGITS } from "bits-ui";

	let {
		otpCode = $bindable(),
		authBusy,
		authError,
		onVerify,
		onUseAnotherEmail,
		onResendCode,
	}: {
		otpCode: string;
		authBusy: boolean;
		authError: string;
		onVerify: () => void | Promise<void>;
		onUseAnotherEmail: () => void;
		onResendCode: () => void | Promise<void>;
	} = $props();
</script>

<section class="flex flex-col gap-5">
	<PinInput.Root
		bind:value={otpCode}
		maxlength={6}
		disabled={authBusy}
		pattern={REGEXP_ONLY_DIGITS}
		textalign="center"
		autocomplete="one-time-code"
		inputmode="numeric"
		aria-label="Einmalcode"
		pasteTransformer={(value) => value.replace(/\D/g, ``).slice(0, 6)}
		onComplete={() =>
			queueMicrotask(() => {
				void onVerify();
			})}
		class="mx-auto max-w-[240px] py-2"
	>
		{#snippet children({ cells })}
			<div class="flex justify-center">
				{#each cells as cell, i (i)}
					<PinInput.Cell
						{cell}
						class="border-base-500 data-active:outline-primary data-active:bg-primary/15 flex h-14 w-10 shrink items-center justify-center border-y-2 border-r font-mono text-xl tabular-nums first:rounded-l-xl first:border-l-2 last:rounded-r-xl last:border-r-2 data-active:outline"
					>
						{#if cell.char}
							{cell.char}
						{:else if cell.hasFakeCaret}
							<span class="bg-base-content/80 animate-caret-blink h-5 w-px" aria-hidden="true"></span>
						{/if}
					</PinInput.Cell>
				{/each}
			</div>
		{/snippet}
	</PinInput.Root>

	{#if authError}
		<div class="alert alert-error bg-error/60">
			<i class="icon-[ph--warning] size-6"></i>
			<span>{authError}</span>
		</div>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<button type="button" class="btn btn-ghost btn-sm" disabled={authBusy} onclick={onUseAnotherEmail}> Andere E-Mail verwenden </button>
		<button type="button" class="btn btn-ghost btn-sm" disabled={authBusy} onclick={onResendCode}> Code erneut senden </button>
	</div>
</section>
