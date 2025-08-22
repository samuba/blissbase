<script lang="ts">
	import { routes } from '$lib/routes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class=" flex items-center justify-center">
	<div>
		<!-- header -->
		<div class="flex items-center justify-between px-4">
			<a href="/" class="my-4 flex items-center justify-center gap-4">
				<img src="favicon.png" alt="Blissbase" class="size-10 min-w-10" />
				<h1 class="text-base-content text-2xl font-bold">Blissbase</h1>
			</a>

			<a href="/" class="btn-sm btn">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück
			</a>
		</div>

		<div class="card bg-base-100 sm:rounded-box w-full max-w-2xl rounded-none">
			<div class="card-body gap-4">
				<div>
					<h1 class="text-2xl font-bold">Event erstellen</h1>
				</div>

				<div class="flex flex-col gap-4">
					Es gibt mehrere Möglichkeiten wie du einen Event erstellen kannst:

					<div class="card bg-info/15">
						<div class="card-body">
							<h3 class="card-title">Telegram-Bot</h3>

							<div>
								Sende deinen Event an meinen Telegram-Bot.
								<br /><b> Achtung:</b>
								Beschreibung, Ort, Datum und Bild muss alles in einer Nachricht sein!
							</div>

							<div class="card-actions">
								<a
									href="https://t.me/blissbase_bot"
									target="_blank"
									rel="noopener noreferrer"
									class="btn btn-info"
									>Event an Telegram-Bot senden
								</a>
							</div>
						</div>
					</div>

					<div class="card bg-accent/25">
						<div class="card-body">
							<h3 class="card-title">Event Quellen</h3>
							Trage deinen Event in eine meiner Event Quellen ein. Ich importiere regelmäßig Events aus
							diesen Quellen. In etwa einem halben Tag solltest du dein Event hier sehen können dauert
							es etwa einen halben

							<div class="card-actions">
								<a href={routes.sources()} class="btn btn-accent">Event Quellen anzeigen</a>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="flex justify-center p-4">
			<a href="/" class="btn-sm btn">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zurück
			</a>
		</div>
	</div>
</div>

<!-- <p>
						<span class="font-semibold"> Wie kann ich meinen Event eintragen? </span>
						<br />
						Sende deinen Event einfach an meinen
						<a
							href="https://t.me/blissbase_bot"
							target="_blank"
							rel="noopener noreferrer"
							class="link font-semibold">Telegram-Bot</a
						>. Ort, Datum und Bild muss alles in einer Nachricht sein.
						<br />
						Oder trage deinen Event in eine der Quellen ein:
					</p>

					<a href={routes.sources()} class="btn-sm btn w-fit">Event Quellen</a> -->
