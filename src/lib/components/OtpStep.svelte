<script lang="ts">
	import { PinInput, REGEXP_ONLY_DIGITS } from "bits-ui";
	import GoogleSignInButton from "$lib/components/GoogleSignInButton.svelte";

	let {
		email = $bindable(),
		otpCode = $bindable(),
		pendingEmail,
		authBusy,
		authError,
		emailCheckError = ``,
		emailTestId,
		onVerify,
		onUseAnotherEmail,
		onResendCode,
		onGoogleSignIn,
		onEmailInput,
		onEmailBlur,
	}: {
		email: string;
		otpCode: string;
		pendingEmail: string;
		authBusy: boolean;
		authError: string;
		emailCheckError?: string;
		emailTestId: string;
		onVerify: () => void | Promise<void>;
		onUseAnotherEmail: () => void;
		onResendCode: () => void | Promise<void>;
		onGoogleSignIn: () => void | Promise<void>;
		onEmailInput: (event: Event) => void;
		onEmailBlur: () => void | Promise<void>;
	} = $props();

	const awaitingCode = $derived(Boolean(pendingEmail));
</script>

<section class="flex flex-col gap-5" data-testid="otp-step" data-wizard-step="otp">
	{#if awaitingCode}
		<div class="alert alert-success bg-success/60">
			<i class="icon-[ph--keyhole] size-7"></i>
			<span class="text-base-content">
				Wir haben dir einen Code an <b>{pendingEmail}</b> geschickt. Gib den Code hier ein, um dich anzumelden.
			</span>
		</div>

		<div data-testid="otp-input">
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
		</div>

		{#if authError}
			<div class="alert alert-error bg-error/60">
				<i class="icon-[ph--warning] size-6"></i>
				<span>{authError}</span>
			</div>
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-3">
			<button type="button" class="btn btn-ghost btn-sm" disabled={authBusy} onclick={onUseAnotherEmail}>
				Andere E-Mail verwenden
			</button>
			<button type="button" class="btn btn-ghost btn-sm" disabled={authBusy} onclick={() => void onResendCode()}>
				Code erneut senden
			</button>
		</div>
	{:else}
		<GoogleSignInButton busy={authBusy} disabled={authBusy} onclick={() => void onGoogleSignIn()} />

		<div class="divider">oder</div>

		<fieldset class="fieldset">
			<input
				class="input peer w-full"
				data-testid={emailTestId}
				type="email"
				bind:value={email}
				autocomplete="email"
				required
				placeholder="deine@email.de"
				disabled={authBusy}
				oninput={onEmailInput}
				onblur={() => void onEmailBlur()}
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">E-Mail</legend>
			<p class="label">Nicht öffentlich. Wir senden dir einen Code, um dich anzumelden.</p>
			{#if emailCheckError}
				<p class="text-error text-xs">{emailCheckError}</p>
			{/if}
		</fieldset>

		{#if authError}
			<div class="alert alert-error bg-error/60">
				<i class="icon-[ph--warning] size-6"></i>
				<span>{authError}</span>
			</div>
		{/if}
	{/if}
</section>
