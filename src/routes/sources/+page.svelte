<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class=" flex items-center justify-center">
	<div>
		<!-- header -->
		<a href="/" class="my-4 flex items-center justify-center gap-4">
			<img src="favicon.png" alt="Blissbase" class="size-10 min-w-10" />
			<h1 class="text-base-content text-2xl font-bold">Blissbase</h1>
		</a>

		<div class="card bg-base-100 sm:rounded-box w-full max-w-2xl rounded-none">
			<div class="card-body gap-8">
				<div>
					<h1 class="text-2xl font-bold">Event Quellen</h1>
					<p>Aus diesen Quellen beziehen wir mehrmals täglich Events für euch.</p>
				</div>

				<div>
					<h2 class="text-lg font-bold">Websites</h2>
					<div class="flex flex-col gap-2 text-lg underline">
						<a href="https://sei.jetzt" target="_blank">sei.jetzt</a>
						<a href="https://tribehaus.org" target="_blank">tribehaus.org</a>
						<a href="https://awara.events" target="_blank">awara.events</a>
						<a href="https://heilnetz.de" target="_blank">heilnetz.de</a>
						<a href="https://heilnetz-owl.de" target="_blank">heilnetz-owl.de</a>
					</div>
				</div>

				<div>
					<h2 class="text-lg font-bold">Telegram</h2>
					<div class="flex flex-col gap-2 text-lg">Kendralah-Experience</div>
				</div>
			</div>
		</div>
	</div>
</div>
