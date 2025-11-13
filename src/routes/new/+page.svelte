<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
import { routes } from '$lib/routes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader backRoute="/" />

<div class=" flex items-center justify-center">
	<div>
		<div class="card bg-base-100 sm:rounded-box w-full max-w-2xl rounded-none">
			<div class="card-body gap-4">
				<div>
					<h1 class="text-2xl font-bold">Event erstellen</h1>
				</div>

				<div class="flex flex-col gap-4">
					Es gibt mehrere Möglichkeiten wie du einen Event erstellen kannst:

					<div class="card bg-info/15">
						<div class="card-body">
							<h3 class="card-title flex gap-2.5">
								<i class="icon-[ph--telegram-logo] size-7"></i>
								Telegram-Bot
							</h3>

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
									class="btn btn-info bg-info/70 hover:bg-info"
									>Event an Telegram-Bot senden
									<i class="icon-[ph--arrow-right] size-5"></i>
								</a>
							</div>
						</div>
					</div>

					<div class="card bg-accent/30">
						<div class="card-body">
							<h3 class="card-title flex gap-2.5">
								<i class="icon-[ph--book-open] size-7"></i>
								Event Quellen
							</h3>
							Trage deinen Event in eine meiner Event Quellen ein. Ich importiere regelmäßig Events aus
							diesen Quellen. Nach etwa einem halben Tag solltest du dein Event hier sehen.

							<div class="card-actions">
								<a href={routes.sources()} class="btn btn-accent"
									>Event Quellen anzeigen <i class="icon-[ph--arrow-right] size-5"></i></a
								>
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