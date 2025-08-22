<script lang="ts">
	import { routes } from '$lib/routes';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class=" flex items-center justify-center">
	<div>
		<!-- header -->
		<div class="flex items-center justify-between px-4">
			<a href="/" class="my-4 flex items-center justify-center gap-4">
				<img src="favicon.png" alt="Blissbase" class="size-10 min-w-10" />
				<h1 class="text-base-content text-2xl font-bold">Blissbase</h1>
			</a>

			<a href={routes.newEvent()} class="btn-sm btn">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück
			</a>
		</div>

		<div class="card bg-base-100 sm:rounded-box w-full max-w-2xl rounded-none">
			<div class="card-body gap-8">
				<div>
					<h1 class="text-2xl font-bold">Event Quellen</h1>
					<p>
						Aus diesen Quellen beziehe ich mehrmals täglich Events für euch. <br />Trage deinen
						Event in einer davon ein damit er ein paar Stunden später auf Blissbase erscheint.
					</p>
				</div>

				<div>
					<h2 class="mb-1 text-lg font-bold">Websites</h2>
					<div class="flex flex-col gap-1.5 text-lg underline">
						<a href="https://sei.jetzt" target="_blank">sei.jetzt</a>
						<a href="https://tribehaus.org" target="_blank">tribehaus.org</a>
						<a href="https://awara.events" target="_blank">awara.events</a>
						<a href="https://heilnetz.de" target="_blank">heilnetz.de</a>
						<a href="https://heilnetz-owl.de" target="_blank">heilnetz-owl.de</a>
						<a href="https://www.ganzheitlich-gesund-brandenburg.de" target="_blank">
							ganzheitlich-gesund-brandenburg.de
						</a>
						<a href="https://kuschelraum.de" target="_blank">kuschelraum.de</a>
					</div>
				</div>

				<div>
					<h2 class="mb-1 text-lg font-bold">Telegram</h2>
					<div class="flex flex-col gap-1.5 text-lg">
						<a href="https://t.me/+fwGUbapUkrBhYTdi" target="_blank" class="link">
							Bewegungsnetz Bielefeld und Umgebung
						</a>
						<a href="tg://resolve?domain=@youmeunity" target="_blank" class="link">YouMeUnity</a>
						<a href="tg://c/2424846023" target="_blank" class="link">Kendralah-Experience</a>
						und noch {data.scrapingTargets.length} weitere Gruppen und Kanäle.

						<!-- {#each data.scrapingTargets as target}
							{@const roomUrl = target.roomId.startsWith('-100')
								? `https://t.me/c/${target.roomId.replace('-100', '')}/${target.lastMessageId ?? 1}`
								: `tg://resolve?domain=${target.roomId}`}
							<a href={roomUrl} target="_blank" class="link">{target.name}</a>
						{/each} -->
					</div>
				</div>
			</div>
		</div>

		<div class="flex justify-center p-4">
			<a href={routes.newEvent()} class="btn-sm btn">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück
			</a>
		</div>
	</div>
</div>
