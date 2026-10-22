<script lang="ts">
	/* @wc-include */
	import { routes } from '$lib/routes';

	let { data } = $props();
	const faqRecentEventCounts = $derived(data.faqRecentEventCounts);
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-6">
	<div class="flex flex-col gap-4">
		<div class="card bg-base-100 p-6 shadow">
			<h1 class="text-2xl font-semibold">FAQ</h1>
			<p class="mt-2 text-base-content/75">
				Antworten auf die häufigsten Fragen rund um Blissbase.
			</p>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Was ist Blissbase?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Blissbase ist dein Portal für Expansion. Wir bringen Events und persönliche Angebote an
					einem durchsuchbaren Ort zusammen – für Wohlbefinden, persönliches Wachstum und tiefe
					menschliche Verbindung.
				</p>
				<p>
					Verbringe weniger Zeit mit Suchen und mehr damit, zu entdecken, was um dich herum
					passiert, deine Menschen zu finden und dabei zu sein.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Welche Regionen werden unterstützt?</h2>
			<div class="mt-2 text-base-content/80">
				<p>
					Du kannst Blissbase weltweit nutzen – am besten unterstützt sind zur Zeit die Regionen
					hier, mit der Anzahl <b>neuer Events der letzten zwei Monate</b>.
				</p>
				{#if faqRecentEventCounts.regions?.length}
					<ul class="mt-3 space-y-1.5 text-sm">
						{#each faqRecentEventCounts.regions as region (region.key)}
							<li class="flex gap-4 border-b border-base-200 pb-1.5 last:border-0 last:pb-0">
								<span>{region.label}</span>
								<span class="grow"></span>
								<span class="shrink-0 tabular-nums font-medium">{region.count}</span>Neue Events
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm italic">Für Regionen liegen gerade keine Zahlen vor.</p>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Für wen ist Blissbase?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>Für Menschen, die nach bedeutsamen Erfahrungen suchen, und für die, die sie gestalten.</p>
				<p>
					Die Entdeckenden nennen wir Suchende, und die, die ihre Arbeit teilen, Anbieter. Zu den
					Anbietern gehören Facilitators, Lehrer:innen, Veranstalter:innen, Locations, Schulen und
					Retreat-Leiter:innen.
				</p>
				<p>
					Ob du deine Community findest oder Menschen zusammenbringst – hier bist du willkommen.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Ist Blissbase kostenlos?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Ja. Stöbern, ein Profil anlegen, Lieblings-Events speichern und deine Events und Angebote
					einstellen ist kostenlos.
				</p>
				<p>Einzelne Erfahrungen können einen eigenen Preis haben – den legt der Anbieter fest.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Was ist der Unterschied zwischen Events und Angeboten?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Events finden zu einem festgelegten Zeitpunkt statt – zum Beispiel Workshops, Tänze,
					Festivals oder Community-Treffen.
				</p>
				<p>
					Angebote sind persönliche Sessions und Services auf Anfrage, zum Beispiel Coaching,
					Massage oder eine private Session. Sie können vor Ort, online oder beides verfügbar sein.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">
				Warum sollte ich ein Konto anlegen, wenn ich nach Erfahrungen suche?
			</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Speichere Events, die dich ansprechen, und behalte sie unter
					<a href={routes.favorites()} class="link font-semibold">Favoriten</a> zusammen. Tippe auf
					das Herz bei einem Event, um später darauf zurückzukommen, wenn du Pläne machst.
				</p>
				<p>
					Du kannst ohne Konto stöbern. Zum Anmelden öffne
					<a href={routes.profile()} class="link font-semibold">Profil</a> und nutze Google oder
					lass dir einen Login-Code per E-Mail schicken.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">
				Warum sollte ich ein Profil anlegen, wenn ich Events oder Services anbiete?
			</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Stelle dich vor und bringe deine Events, Angebote, Website und Social-Links auf einer
					öffentlichen Seite zusammen, die du teilen kannst.
				</p>
				<p>
					Dein Profil hilft anderen, deine Arbeit zu entdecken und zu sehen, was du noch anbietest.
					Profil anlegen und Einträge veröffentlichen ist kostenlos. Starte über
					<a href={routes.profile()} class="link font-semibold">Profil</a> – mit Google oder einem
					Login-Code per E-Mail.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie suche ich nach Events?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>Suche per Stichwort und kombiniere diese Filter:</p>
				<ul class="list-disc space-y-2 pl-5">
					<li>
						<b>Kategorien:</b> Tanz, Breathwork, Tantra, Meditation, Bewegung, Energiearbeit, Sound
						Healing, Körperarbeit, Musik, Beziehung, Persönliche Entwicklung, Spiritualität und
						Zeremonie. Unter Sonstiges findest du noch mehr.
					</li>
					<li>
						<b>Ort und Entfernung:</b> Gib eine Stadt oder Postleitzahl ein und wähle einen
						Suchradius oder Überall.
					</li>
					<li>
						<b>Zeitraum:</b> Wähle Daten oder Diese Woche, Dieses Wochenende, Nächste Woche, Nächste
						30 Tage oder Alle zukünftigen Events.
					</li>
					<li><b>Teilnahme:</b> Wähle Vor Ort oder Online.</li>
				</ul>
				<p>
					Sortiere nach Startzeit oder Entfernung. Wenn du wenig findest, erweitere Entfernung oder
					Zeitraum, entferne eine Kategorie oder wähle Alle Filter zurücksetzen.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Kann ich auch woanders als an meinem aktuellen Ort stöbern?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Ja. Blissbase hilft dir, dich mit deiner Community zu Hause zu verbinden und deine
					Community unterwegs zu finden.
				</p>
				<p>
					Ändere den Ort zu dem Ziel, wohin du unterwegs bist, und entdecke, was dort passiert.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie finde ich private Sessions und Services?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Öffne <a href={routes.offeringsList()} class="link font-semibold">Angebote</a> und suche
					nach Stichwort, Ort und Entfernung. Wähle „Online Angebote auch anzeigen“, um Sessions
					einzubeziehen, die remote verfügbar sind.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">
				Wie bekomme ich mehr Infos oder buche ich ein Event oder Angebot?
			</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Das hängt vom Event oder Angebot und vom Anbieter ab. Nutze die Kontaktdaten oder
					Buchungsangaben im Eintrag. Das kann ein Link, WhatsApp, Telegram, E-Mail oder eine
					Telefonnummer sein. Manche Events brauchen keine Anmeldung.
				</p>
				<p>
					Manche Anbieter-Profile haben auch Website- und Instagram-Buttons. Bei Events, die von
					einer anderen Plattform stammen, folge dem Quellen-Link zum Original-Eintrag.
				</p>
				<p>Ticketing über Blissbase ist für die Zukunft geplant.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie stelle ich mein Event ein?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Wähle <a href={routes.newEvent()} class="link font-semibold">Event hinzufügen</a> und gib
					Name, Datum, Uhrzeit, Beschreibung, Ort oder Online-Format und Anmelde-Details ein. Füge
					Bilder, einen Preis und Tags hinzu, wo es passt.
				</p>
				<p>
					Hast du schon Werbetext oder einen Flyer? Nutze Automatisch ausfüllen, um beim Ausfüllen
					der Felder zu helfen – und prüfe die Angaben danach.
				</p>
				<p>
					Behalte deine bestehende Buchungsmethode, indem du sie unter „Anmeldung / Tickets über“
					hinterlegst. Für ein Event, das du nur per Link teilen willst, wähle „Event nicht in Suche
					anzeigen“.
				</p>
				<p>
					Du kannst auch über
					<a
						href="https://t.me/blissbase_bot"
						target="_blank"
						rel="noopener noreferrer"
						class="link font-semibold">@blissbase_bot</a
					> auf Telegram einreichen. Beschreibung, Ort, Datum und Bild müssen zusammen in einer
					einzigen Nachricht stehen.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie stelle ich meine persönlichen Sessions oder Services ein?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Öffne <a href={routes.offeringsList()} class="link font-semibold">Angebote</a> und wähle
					<a href={routes.newOffering()} class="link font-semibold">Angebot hinzufügen</a>. Ergänze
					Titel, Beschreibung, Bilder und ob es vor Ort, online oder beides verfügbar ist.
				</p>
				<p>
					Dein Angebot kann auf der Angebote-Seite und in deinem öffentlichen Profil erscheinen.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Woher kommen die Event-Einträge auf Blissbase?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Anbieter stellen Events direkt ein, und Blissbase sammelt außerdem Einträge aus
					öffentlichen Kalendern, Websites und Community-Kanälen.
				</p>
				<p>
					Wir bringen die Informationen zusammen, damit du nicht durch separate Websites, Apps und
					Gruppen suchen musst.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wo wächst Blissbase als Nächstes?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Unser Ziel ist, der einfachste Ort zu werden, um die relevantesten Erfahrungen zu finden –
					wo immer du dich auf deiner Reise befindest.
				</p>
				<p>
					Wir fokussieren unsere Expansion auf spirituelle Hubs, darunter Ubud auf Bali, San Marcos
					am Lago de Atitlán in Guatemala, Ibiza, Tulum, Goa und Koh Phangan. Außerdem wollen wir in
					Orte mit bewussten Communities wachsen, darunter Austin in den USA und Byron Bay in
					Australien. Mehr folgt bald.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie kann ich meine lokale Community zu Blissbase bringen?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>Möchtest du deine Stadt besser vertreten sehen? Hilf uns, die Tür zu öffnen.</p>
				<p>
					Stelle uns lokale Anbieter vor, teile öffentliche Event-Kalender und Community-Kanäle oder
					verbinde uns mit den Menschen, die deine Community zusammenbringen.
				</p>
				<p>
					Wir freuen uns über Ambassadors und Collaborators, die die Erfahrungen ihrer Stadt an
					einem Ort zusammenbringen wollen. Schreib an
					<a href="mailto:hi@blissbase.app" class="link font-semibold">hi@blissbase.app</a> mit
					deinem Ort und wie du mitwirken möchtest.
				</p>
			</div>
		</div>
	</div>
</div>
