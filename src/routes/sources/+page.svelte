<script lang="ts">
	import { routes } from '$lib/routes';
</script>

<div class="flex items-center justify-center">
	<div>
		<div class="card bg-base-100 sm:rounded-box w-full max-w-2xl rounded-none">
			<div class="card-body gap-8">
				<div class="space-y-3">
					<h1 class="text-2xl font-bold">Event-Quellen</h1>
					<p class="text-base-content/80">
						Neben Events, die direkt auf Blissbase eingetragen werden, hole ich mehrmals täglich
						Termine aus öffentlichen Kalendern, Websites und Community-Kanälen ab.
					</p>
					<p class="text-base-content/80">
						Du kannst deinen Event auch in einer dieser Quellen eintragen – nach ein paar Stunden
						sollte er hier auftauchen. Noch direkter geht's über
						<a href={routes.root()} class="link font-semibold">Event hinzufügen</a>
						auf der Startseite oder per
						<a
							href="https://t.me/blissbase_bot"
							target="_blank"
							rel="noopener noreferrer"
							class="link font-semibold">Telegram-Bot</a
						>. Mehr dazu steht in der
						<a href={routes.faq()} class="link font-semibold">FAQ</a>.
					</p>
				</div>

				<div>
					<h2 class="mb-1 text-lg font-bold">Websites</h2>
					<div class="flex flex-col gap-1.5 text-lg underline">
						<a href="https://sei.jetzt" target="_blank" rel="noopener noreferrer">sei.jetzt</a>
						<a href="https://tribehaus.app" target="_blank" rel="noopener noreferrer">tribehaus.app</a>
						<a href="https://heilnetz.de" target="_blank" rel="noopener noreferrer">heilnetz.de</a>
						<a href="https://heilnetz-owl.de" target="_blank" rel="noopener noreferrer"
							>heilnetz-owl.de</a
						>
						<a
							href="https://www.ganzheitlich-gesund-brandenburg.de"
							target="_blank"
							rel="noopener noreferrer"
						>
							ganzheitlich-gesund-brandenburg.de
						</a>
						<a href="https://kuschelraum.de" target="_blank" rel="noopener noreferrer"
							>kuschelraum.de</a
						>
						<a href="https://ciglobalcalendar.net" target="_blank" rel="noopener noreferrer"
							>ciglobalcalendar.net</a
						>
					</div>
				</div>

				<div>
					<h2 class="mb-1 text-lg font-bold">Telegram</h2>
					<div class="flex flex-col gap-1.5 text-lg">
						<a
							href="https://t.me/+fwGUbapUkrBhYTdi"
							target="_blank"
							rel="noopener noreferrer"
							class="link"
						>
							Bewegungsnetz Bielefeld und Umgebung
						</a>
						<a
							href="tg://resolve?domain=@youmeunity"
							target="_blank"
							rel="noopener noreferrer"
							class="link">YouMeUnity</a
						>
						<a href="tg://c/2424846023" target="_blank" rel="noopener noreferrer" class="link"
							>Kendralah-Experience</a
						>
						<span class="text-base-content/70">und noch weitere Gruppen und Kanäle.</span>
					</div>
				</div>
			</div>
		</div>

		<div class="flex justify-center p-4">
			<a href={routes.faq()} class="btn btn-sm">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück zur FAQ
			</a>
		</div>
	</div>
</div>
