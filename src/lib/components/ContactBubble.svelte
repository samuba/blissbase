<script lang="ts" module>
	let open = $state(false);

	export function showContactDialog() {
		open = true;
	}
</script>

<script lang="ts">
	import { page } from "$app/state";
	import { Dialog } from "#lib/components/dialog/index.ts";
	import { peekFooter } from "#lib/peekFooter.svelte.ts";
	import { sendContactMessage } from "#lib/rpc/contact.remote.ts";
	import { toast } from "svelte-sonner";

	let email = $state(``);
	let message = $state(``);

	const isPending = $derived(sendContactMessage.pending > 0);

	function onOpenChange(nextOpen: boolean) {
		open = nextOpen;
		if (!nextOpen) return;
		if (email) return;
		email = page.data.jwtClaims?.email ?? ``;
	}

	function resetForm() {
		email = ``;
		message = ``;
	}

	async function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (isPending) return;

		try {
			await sendContactMessage({ email, message });
			toast.success(/* @wc-include */ `Danke! Ich melde mich bald bei dir.`);
			open = false;
			resetForm();
		} catch {
			toast.error(/* @wc-include */ `Nachricht konnte nicht gesendet werden. Versuch es bitte nochmal.`);
		}
	}
</script>

{#if !open}
	<div
		class={[
			`pointer-events-none fixed inset-x-0 z-40`,
			`bottom-[calc(6.5rem+env(safe-area-inset-bottom))] md:bottom-11`,
			`transition-transform duration-200 ease-out motion-reduce:transition-none`,
			!peekFooter.shown && `translate-y-[1.75rem] md:translate-y-0`,
		]}
	>
		<div class="mx-auto flex max-w-5xl justify-start px-4">
			<button
				type="button"
				data-testid="contact-bubble"
				aria-label="Nachricht schreiben"
				onclick={() => onOpenChange(true)}
				class={[
					`btn btn-circle btn-lg bg-base-100/95 text-base-content border-base-300 pointer-events-auto shadow-lg`,
					// Hang beside the card column by button width + gap when the viewport has room.
					`-translate-x-[min(calc(100%+0.75rem),max(0px,calc((100vw-64rem)/2+1rem)))]`,
				]}
			>
				<i class="icon-[ph--chat-circle-dots] size-7"></i>
			</button>
		</div>
	</div>
{/if}

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			class="bg-base-100 fixed top-1/2 left-1/2 z-60 max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl"
			data-testid="contact-dialog"
		>
			<Dialog.Title class="mb-2 pr-8 text-xl font-semibold">Schreib mir</Dialog.Title>
			<p class="text-base-content/70 mb-5 text-sm">Fragen, Feedback oder Ideen — ich freue mich über deine Nachricht.</p>

			<form class="flex flex-col gap-2" onsubmit={onSubmit}>
				<fieldset class="fieldset">
					<textarea
						class="textarea min-h-28 w-full"
						name="message"
						required
						maxlength={10_000}
						placeholder="Was möchtest du mir sagen?"
						bind:value={message}
						disabled={isPending}
						data-testid="contact-message"
					></textarea>
					<legend class="fieldset-legend">Nachricht</legend>
				</fieldset>

				<fieldset class="fieldset">
					<input
						class="input peer w-full"
						type="email"
						name="email"
						autocomplete="email"
						required
						bind:value={email}
						disabled={isPending}
						data-testid="contact-email"
					/>
					<legend class="fieldset-legend">Deine E-Mail-Adresse</legend>
					<p class="label">Damit ich dir antworten kann.</p>
				</fieldset>

				<button type="submit" class="btn btn-primary mt-2 w-full" disabled={isPending} data-testid="contact-submit">
					{#if isPending}
						<span class="loading loading-spinner"></span>
					{:else}
						<i class="icon-[ph--paper-plane-tilt] size-5"></i>
					{/if}
					Senden
				</button>
			</form>

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
