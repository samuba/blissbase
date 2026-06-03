<script lang="ts">
	import { Dialog } from '$lib/components/dialog';
	import { PinInput, REGEXP_ONLY_DIGITS } from 'bits-ui';

	let {
		open = $bindable(false),
		pendingEmail,
		otpCode = $bindable(),
		authBusy,
		authError,
		onVerify,
		onUseAnotherEmail
	}: {
		open: boolean;
		pendingEmail: string;
		otpCode: string;
		authBusy: boolean;
		authError: string;
		onVerify: () => void | Promise<void>;
		onUseAnotherEmail: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.OverlayAnimated class="bg-base-200/80 fixed inset-0 z-60 backdrop-blur-sm" />
		<Dialog.ContentAnimated
			class="bg-base-100 fixed top-1/2 left-1/2 z-70 flex max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-xl p-4 shadow-xl sm:p-6"
		>
			<Dialog.Title class="text-xl font-semibold">E-Mail bestätigen</Dialog.Title>
			<Dialog.Description class="text-base-content/70 text-sm">
				Damit dein Angebot erstellt werden kann, gib bitte den Code ein, den wir an
				<b>{pendingEmail}</b> geschickt haben.
			</Dialog.Description>

			<form
				class="flex flex-col gap-4"
				onsubmit={(event) => {
					event.preventDefault();
					void onVerify();
				}}
			>
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
					class="mx-auto max-w-[200px] py-4"
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
										<span class="bg-base-content/80 animate-caret-blink h-5 w-px" aria-hidden="true"
										></span>
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

				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						class="btn btn-ghost"
						disabled={authBusy}
						onclick={onUseAnotherEmail}
					>
						Andere E-Mail verwenden
					</button>
					<button type="submit" class="btn btn-primary" disabled={authBusy}>
						{#if authBusy}
							<span class="loading loading-spinner loading-sm"></span>
							Wird geprüft…
						{:else}
							Angebot erstellen
						{/if}
					</button>
				</div>
			</form>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
