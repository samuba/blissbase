<script lang="ts">
	// not really a burger menu 🤷🏻‍♂️
	import { routes } from '$lib/routes';
	import { Dialog } from 'bits-ui';

	const { children } = $props();

	let open = $state(false);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{@render children()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/80" />
		<Dialog.Content
			class="card bg-base-100 fixed top-[50%] left-[50%] z-50 w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] outline-hidden sm:max-w-lg sm:p-4 md:w-full"
			onclick={() => (open = false)}
			tabindex={-1}
		>
			<div class="flex max-w-lg flex-col gap-4 p-4 text-sm">
				<h1 class="text-lg leading-tight font-bold">
					<img src="logo.svg" alt="Blissbase" class="mr-1 inline-block size-9 min-w-9" />
					Willkommen bei Blissbase
				</h1>
				<p class="-mt-2">
					Ich will die achtsamen Communities Deutschlands zusammen bringen. Dafür sammel ich Events
					aus verschiedenen Quellen und machen sie hier zugänglich. Durchsuchbar, komfortabel, alles
					an einem Ort.
					<br />
					Ich hoffe dir gefällt meine Arbeit.
				</p>
				<div class="-mt-2 flex items-center gap-3">
					<img src="/me.jpg" alt="Samuel" class="size-12 min-w-12 rounded-full" />
					<div class="flex flex-col">
						<span>Peace, Love & Light 🌻</span>
						<i class="text-sm">Samuel</i>
					</div>
				</div>

				<p>
					PS. Das Projekt ist noch in den Kinderschuhen und ich weiß noch nicht wohin es sich
					entwickelt. Deshalb bin ich sehr dankbar für jedes Feedback, Ideen und Kooperation: <a
						href="mailto:hi@blissbase.app"
						class="link w-fit font-semibold"
					>
						hi@blissbase.app
					</a>
				</p>

				<a href={routes.newEvent()} class="btn btn-primary w-fit">
					<i class="icon-[ph--plus] size-5"></i>
					Neuen Event erstellen
				</a>
			</div>

			<Dialog.Close class="btn btn-circle absolute  top-3 right-3 shadow-lg sm:top-4 sm:right-4">
				<i class="icon-[ph--x] size-5"></i>
				<span class="sr-only">Close</span>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
