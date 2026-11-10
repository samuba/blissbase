<script lang="ts">
	/* @wc-include */
	import { routes } from "#lib/routes.ts";
	import { localeStore } from "../../locales/localeStore.svelte";

	let { data } = $props();
	const faqCountryEventCounts = $derived(data.faqCountryEventCounts);
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-6">
	<div class="flex flex-col gap-4">
		<div class="card bg-base-100 p-6 shadow">
			<h1 class="text-2xl font-semibold">FAQ</h1>
			<p class="text-base-content/75 mt-2">Antworten auf die häufigsten Fragen rund um Blissbase.</p>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Was ist Blissbase?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Blissbase ist dein Portal für Wachstum und Entfaltung. Wir bringen Events sowie 1:1 Sessions und Services an einem Ort zusammen,
					die dein Wohlbefinden, deine persönliche Entwicklung und echte, tiefe Verbindung zwischen Menschen nähren.
				</p>
				<p>Weniger suchen, mehr entdecken: Sieh, was um dich herum passiert, finde deine Menschen und sei dabei.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Für wen ist Blissbase?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>Für alle, die nach bedeutsamen Erfahrungen suchen – und für die Menschen, die sie möglich machen.</p>
				<p>
					Wer stöbert und entdeckt, nennen wir <b>Suchende</b>. Wer die eigene Arbeit teilt, nennen wir <b>Anbieter:innen</b>. Dazu gehören
					Facilitators, Lehrer:innen, Veranstalter:innen, Locations, Schulen und Retreat-Leiter:innen.
				</p>
				<p>Ob du deine Community suchst oder Menschen zusammenbringst: Du bist hier herzlich willkommen.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Ist Blissbase kostenlos?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Ja. Stöbern, ein Profil anlegen, Lieblings-Events speichern und eigene Events und Angebote eintragen – all das kostet dich nichts.
				</p>
				<p>Einzelne Erfahrungen können einen eigenen Preis haben. Den legen die Anbieter:innen selbst fest.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Was ist der Unterschied zwischen Events und Angeboten?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					<b>Events</b> finden zu einem festen Termin statt, zum Beispiel ein Workshop, ein Tanzabend, ein Festival oder ein Community-Treffen.
				</p>
				<p>
					<b>Angebote</b> sind 1:1 Sessions und Services, die du auf Anfrage bekommst, etwa Coaching, eine Massage oder eine private Session.
					Sie können vor Ort, online oder beides sein.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Warum ein Konto anlegen, wenn ich nach Erfahrungen suche?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Damit du Events, die dich ansprechen, speichern kannst und sie gesammelt unter
					<a href={routes.favorites()} class="link font-semibold">Favoriten</a> wiederfindest. Tipp einfach auf das Herz bei einem Event und komm
					darauf zurück, wenn du deine Pläne schmiedest.
				</p>
				<p>
					Stöbern geht auch ganz ohne Konto. Zum Registrieren öffne
					<a href={routes.profile()} class="link font-semibold">Meins</a> und melde dich mit Google an oder lass dir einen Login-Code per E-Mail
					schicken.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Warum ein Profil anlegen, wenn ich Events oder Angebote anbiete?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Stell dich vor und bring deine Events, Angebote, Website und Social-Media-Links auf einer öffentlichen Seite zusammen, die du ganz
					einfach teilen kannst.
				</p>
				<p>
					Über dein Profil entdecken Menschen deine Arbeit und sehen, was du sonst noch anbietest. Profil anlegen und Einträge
					veröffentlichen ist kostenlos. Los geht's unter
					<a href={routes.profile()} class="link font-semibold">Meins</a> – mit Google oder einem Login-Code per E-Mail.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie suche ich nach Events?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>Am besten setzt du zuerst deinen Ort. So siehst du direkt, was in deiner Nähe los ist.</p>
				<p>
					In der Textsuche kannst du dann frei eingeben, wonach dir ist, oder eine der Kategorien wählen. Mit weiteren Filtern grenzt du die
					Ergebnisse ein – etwa nach Zeitraum oder danach, ob ein Event vor Ort oder online stattfindet.
				</p>
				<p>Du findest wenig? Dann lockere einfach ein paar Filter und entdecke, was sonst noch los ist.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Kann ich auch woanders als an meinem aktuellen Ort stöbern?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>Ja! Mit Blissbase bleibst du mit deiner Community zu Hause verbunden und findest auch auf Reisen schnell Anschluss.</p>
				<p>Stell einfach den Ort ein, an den es dich zieht, und schau, was dort los ist.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie finde ich 1:1 Sessions und Services?</h2>
			<p class="text-base-content/80 mt-2">
				Öffne <a href={routes.offeringsList()} class="link font-semibold">Angebote</a> und such nach Stichwort, Ort und Entfernung. Mit „Online
				Angebote auch anzeigen“ siehst du zusätzlich Sessions, die online stattfinden.
			</p>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie bekomme ich mehr Infos oder buche ein Event oder Angebot?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Das hängt vom jeweiligen Event oder Angebot und von den Anbieter:innen ab. Nutze die Kontaktdaten oder Buchungshinweise im Eintrag
					– das kann ein Link sein, WhatsApp, Telegram, E-Mail oder eine Telefonnummer. Für manche Events musst du dich gar nicht anmelden.
				</p>
				<p>Tickets direkt über Blissbase zu buchen, ist für die Zukunft geplant.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie trage ich mein Event ein?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Klick auf <a href={routes.newEvent()} class="link font-semibold">Event hinzufügen</a> und füll das Formular aus.
				</p>
				<p>
					Du hast schon einen Werbetext oder Flyer? Mit „Automatisch ausfüllen“ werden die Felder für dich vorausgefüllt. Prüf die Angaben
					einfach kurz, bevor du weitermachst.
				</p>
				<p>
					Deinen bisherigen Buchungsweg kannst du behalten: Trag ihn unter „Anmeldung / Tickets über“ ein. Möchtest du dein Event nur per
					Link teilen, wähle „Event nicht in Suche anzeigen“.
				</p>
				<p>
					Du kannst Events auch über
					<a href="https://t.me/blissbase_bot" target="_blank" rel="noopener noreferrer" class="link font-semibold">@blissbase_bot</a>
					auf Telegram einreichen. Schick Beschreibung, Ort, Datum und Bild zusammen in
					<b>einer einzigen Nachricht</b>.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie trage ich meine 1:1 Sessions und Services ein?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Öffne <a href={routes.offeringsList()} class="link font-semibold">Angebote</a> und klick auf
					<a href={routes.newOffering()} class="link font-semibold">Angebot hinzufügen</a>. Ergänze Titel, Beschreibung, Bilder und ob dein
					Angebot vor Ort, online oder beides stattfindet.
				</p>
				<p>Dein Angebot kann dann auf der Angebote-Seite und in deinem öffentlichen Profil erscheinen.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Woher kommen die Events auf Blissbase?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Anbieter:innen tragen ihre Events direkt ein. Außerdem sammelt Blissbase Einträge aus öffentlichen Kalendern, Websites und
					Community-Kanälen.
				</p>
				<p>
					Wir bringen alles zusammen, damit du dich nicht durch zig Websites, Apps und Gruppen klicken musst. Die vollständige Liste findest
					du unter
					<a href={routes.sources()} class="link font-semibold">Event-Quellen</a>.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Welche Länder werden unterstützt?</h2>
			<div class="text-base-content/80 mt-2">
				<p>Du kannst Blissbase weltweit nutzen – am besten unterstützt sind zur Zeit folgende Länder.</p>
				{#if faqCountryEventCounts.regions?.length}
					<ul class="mt-3 grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-x-1.5 gap-y-1.5 text-sm">
						{#each faqCountryEventCounts.regions as region, i (region.key)}
							{@const cellBorder = i < faqCountryEventCounts.regions.length - 1 ? `border-b border-base-200 pb-1.5` : undefined}
							<li class="contents">
								<span class={cellBorder}>{region.label}</span>
								<span class={[`text-right tabular-nums`, cellBorder]}>{region.count.toLocaleString(localeStore.longLocale)}</span>
								<!-- @wc-context: faq-event-count -->
								<span class={cellBorder}>Events</span>
								<span class={[`pl-3 text-right tabular-nums`, cellBorder]}
									>{region.upcomingCount.toLocaleString(localeStore.longLocale)}</span
								>
								<span class={cellBorder}>bevorstehende</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm italic">Für Länder liegen gerade keine Zahlen vor.</p>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wo wächst Blissbase als Nächstes?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>
					Unser Ziel: der einfachste Ort zu werden, um die Erfahrungen zu finden, die für dich wirklich zählen – wo auch immer du gerade auf
					deinem Weg stehst.
				</p>
				<p>
					Beim Ausbau konzentrieren wir uns auf spirituelle Hotspots wie Ubud auf Bali, San Marcos am Atitlán-See in Guatemala, Ibiza,
					Tulum, Goa und Koh Phangan. Außerdem möchten wir an Orten mit bewussten Communities wachsen, etwa in Austin (USA) und Byron Bay
					(Australien). Weitere folgen bald.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie kann ich helfen, meine lokale Community auf Blissbase zu bringen?</h2>
			<div class="text-base-content/80 mt-2 space-y-3">
				<p>Du wünschst dir, dass deine Stadt hier besser vertreten ist? Hilf uns, die Tür zu öffnen.</p>
				<p>
					Stell uns lokale Anbieter:innen vor, teile öffentliche Event-Kalender und Community-Kanäle oder bring uns mit den Menschen
					zusammen, die deine Community verbinden.
				</p>
				<p>
					Wir freuen uns über Ambassadors und Mitwirkende, die die Erfahrungen ihrer Stadt an einem Ort zusammenbringen möchten. Schreib uns
					an
					<a href="mailto:hi@blissbase.app" class="link font-semibold">hi@blissbase.app</a>, wo du lebst und wie du dich einbringen
					möchtest.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie kann ich Feedback schicken oder Hallo sagen?</h2>
			<p class="text-base-content/80 mt-2">
				Am einfachsten per Mail an
				<a href="mailto:hi@blissbase.app" class="link font-semibold">hi@blissbase.app</a>. Wir freuen uns über jedes Feedback, Ideen,
				Korrekturen und Kooperationen.
			</p>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<p>
				Deine Frage wurde nicht beantwortet?
				<a href="mailto:hi@blissbase.app" class="link ml-1 font-semibold">Schreib uns.</a>
			</p>
		</div>
	</div>
</div>
