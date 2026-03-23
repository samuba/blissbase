<script lang="ts" module>
	let open = $state(false);
	let message = $state('');
	let type = $state<'success' | 'error'>('success');

	export function showAuthFeedback(feedbackType: 'success' | 'error', feedbackMessage: string) {
		type = feedbackType;
		message = feedbackMessage;
		open = true;
	}

	export function closeAuthFeedback() {
		open = false;
	}
</script>

<script lang="ts">
	import { Dialog } from '$lib/components/dialog';
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated class="bg-base-100 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl">
			<div class="flex flex-col items-center text-center">
				{#if type === 'success'}
					<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
						<i class="icon-[ph--check-circle] size-10 text-success"></i>
					</div>
					<Dialog.Title class="mb-2 text-xl font-semibold">Erfolgreich angemeldet</Dialog.Title>
				{:else}
					<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error/20">
						<i class="icon-[ph--warning-circle] size-10 text-error"></i>
					</div>
					<Dialog.Title class="mb-2 text-xl font-semibold">Anmeldung fehlgeschlagen</Dialog.Title>
				{/if}

				<p class="text-base-content/80 mb-6">{message}</p>

				<button 
					onclick={() => open = false}
					class="btn btn-primary w-full"
				>
					{type === 'success' ? 'Weiter' : 'Schließen'}
				</button>
			</div>

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
