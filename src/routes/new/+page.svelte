<script lang="ts">
	import { page } from '$app/state';
	import { OfferingsFeatureFlag } from '$lib/OfferingsFeatureFlag.svelte';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
</script>

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 md:pb-6">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		<div class="card-body gap-4 p-4 sm:p-6">
			<div class={[`grid gap-4`, OfferingsFeatureFlag.isEnabled && `sm:grid-cols-2`]}>
				<a
					href={routes.newEvent()}
					class="card bg-primary/10 transition-all hover:-translate-y-0.5 hover:shadow-md"
					data-sveltekit-preload-code="eager"
					data-sveltekit-preload-data="hover"
				>
					<div class="card-body gap-3">
						<h2 class="card-title flex items-center gap-2">
							<i class="icon-[ph--calendar-plus] size-6"></i>
							Event erstellen
						</h2>
						<p class="text-sm">
							Ein einzelner Termin, Workshop oder Circle mit Datum und Uhrzeit.
						</p>
						<div class="card-actions">
							<span class="btn btn-primary">
								Event erstellen
								<i class="icon-[ph--arrow-right] size-5"></i>
							</span>
						</div>
					</div>
				</a>

				{#if OfferingsFeatureFlag.isEnabled}
					<a
						href={routes.newOffering()}
						class="card bg-secondary/15 transition-all hover:-translate-y-0.5 hover:shadow-md"
					>
						<div class="card-body gap-3">
							<h2 class="card-title flex items-center gap-2">
								<i class="icon-[ph--hand-heart] size-6"></i>
								Angebot erstellen
							</h2>
							<p class="text-sm">
								Ein dauerhaft sichtbares Angebot, das Menschen direkt anfragen können.
							</p>
							<div class="card-actions">
								<span class="btn btn-secondary">
									Angebot erstellen
									<i class="icon-[ph--arrow-right] size-5"></i>
								</span>
							</div>
						</div>
					</a>
				{/if}
			</div>

			<h2 class="text-base-content/70 mt-4 text-sm font-semibold tracking-wide uppercase">
				Weitere Wege
			</h2>

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
						<a href={resolve(`/sources`)} class="btn btn-accent"
							>Event Quellen anzeigen <i class="icon-[ph--arrow-right] size-5"></i></a
						>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
