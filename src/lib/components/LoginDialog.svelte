<script lang="ts" module>
	let open = $state(false);

	export function showLoginDialog() {
		open = true;
	}
</script>

<script lang="ts">
	import { Dialog } from '$lib/components/dialog';
	import Login from '$lib/components/Login.svelte';
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated class="bg-base-100 fixed top-1/2 left-1/2 z-60 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-6 shadow-xl">
			<Dialog.Title class="mb-4 text-xl font-semibold">Anmelden</Dialog.Title>

			<Login onAuthenticated={() => (open = false)} />

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
