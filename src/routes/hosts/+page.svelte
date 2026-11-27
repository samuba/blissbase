<script lang="ts">
	import EventCard from "#lib/components/EventCard.svelte";
	import { routes } from "#lib/routes.ts";
	import type { UiEvent } from "#lib/server/events.ts";

	function createPreviewDates() {
		const today = new Date();
		const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
		const year = today.getFullYear();
		const month = today.getMonth();
		const day = today.getDate() + daysUntilFriday;
		return {
			startAt: new Date(year, month, day, 19, 30, 0, 0),
			endAt: new Date(year, month, day, 22, 30, 0, 0),
		};
	}

	const { startAt, endAt } = createPreviewDates();

	const previewEvent: UiEvent = {
		id: -1,
		name: `Ecstatic Dance & Kakao`,
		startAt,
		endAt,
		timezone: `Europe/Berlin`,
		address: [`Bamboo Shala`, `Ubud, Bali`],
		addressNote: null,
		price: `25 €`,
		priceIsHtml: false,
		description: null,
		descriptionOriginal: null,
		imageUrls: [`/hosts-preview-bali.webp`],
		host: `Lena & Bamboo Shala`,
		hostLink: null,
		sourceUrl: null,
		contact: [],
		latitude: 52.5015,
		longitude: 13.4186,
		tagSlugs: [`ecstatic-dance`, `cacao-ceremony`, `movement`],
		source: `blissbase`,
		createdAt: startAt,
		updatedAt: startAt,
		messageSenderId: null,
		slug: `ecstatic-dance-kakao-beispiel`,
		soldOut: false,
		listed: true,
		unlistReason: null,
		sourceOrigins: undefined,
		hostSecret: undefined,
		attendanceMode: `offline`,
		structure: `session`,
		language: `de`,
		authorId: null,
		spotlight: null,
		author: undefined,
	};
</script>

<svelte:head>
	<title>Für Hosts · Events kostenlos eintragen | Blissbase</title>
	<meta
		name="description"
		content="Trag deinen Workshop, Ecstatic Dance, Breathwork oder dein Retreat kostenlos auf Blissbase ein und erreiche Menschen, die genau nach solchen Events suchen."
	/>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-12 px-4 pt-6 pb-20 sm:space-y-16 sm:pt-10">
	<section class="grid gap-10 lg:grid-cols-[1.15fr_0.95fr] lg:items-center lg:gap-12">
		<div class="min-w-0">
			<p class="text-base-content/70 mb-5 flex items-center gap-3 text-sm font-semibold">
				<span aria-hidden="true" class="bg-primary h-0.5 w-8 rounded-full"></span>
				Blissbase für Hosts
			</p>
			<h1 class="font-brand text-4xl leading-[1.06] tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
				Bring dein Event dorthin, wo deine Leute schon suchen
			</h1>
			<p class="text-base-content/80 mt-5 max-w-xl text-base leading-relaxed sm:text-lg">
				Ob Ecstatic Dance, Breathwork, Workshop, Kakaozeremonie oder Retreat – auf Blissbase stöbern Menschen gezielt nach Ort, Datum und
				Thema. Trag dein Event kostenlos ein und werde genau dort gefunden.
			</p>

			<div class="mt-7 flex flex-wrap items-center gap-3">
				<a class="btn btn-primary btn-lg rounded-full px-7" href={routes.newEvent()} data-testid="hosts-create-event">
					Event kostenlos eintragen
					<i aria-hidden="true" class="icon-[ph--arrow-right-bold] size-4"></i>
				</a>
				<a
					class="btn btn-outline border-base-300 bg-base-100 hover:bg-base-100/70 hover:border-base-300 rounded-full px-5"
					href={routes.newOffering()}
					data-testid="hosts-create-offering"
				>
					1:1-Angebot erstellen
				</a>
			</div>

			<ul class="text-base-content/70 mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
				<li class="flex items-center gap-1.5">
					<i aria-hidden="true" class="icon-[ph--check-circle-fill] text-primary-content/70 size-4"></i>
					100 % kostenlos
				</li>
				<li class="flex items-center gap-1.5">
					<i aria-hidden="true" class="icon-[ph--check-circle-fill] text-primary-content/70 size-4"></i>
					Keine Provision
				</li>
				<li class="flex items-center gap-1.5">
					<i aria-hidden="true" class="icon-[ph--check-circle-fill] text-primary-content/70 size-4"></i>
					In 2 Minuten live
				</li>
			</ul>
		</div>

		<div class="mx-auto w-full max-w-[25rem] min-w-0 lg:mr-0 lg:ml-auto" aria-hidden="true">
			<div class="mb-2.5 flex items-center justify-between gap-2 px-0.5">
				<span class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">So erscheint dein Event</span>
				<span class="text-base-content/55 text-xs">Beispiel</span>
			</div>

			<div class="hosts-event-card-preview pointer-events-none select-none" inert>
				<EventCard event={previewEvent} class="shadow-md" />
			</div>

			<p class="text-base-content/70 mt-3 flex items-center gap-2 px-0.5 text-xs">
				<i class="icon-[ph--sparkle-fill] text-primary-content/75 size-3.5 shrink-0"></i>
				<span>Flyer hochladen oder Text einfügen – Blissbase füllt die Felder automatisch aus.</span>
			</p>
		</div>
	</section>

	<section
		aria-label="Reichweite von Blissbase"
		class="bg-base-100 border-base-300/70 grid gap-6 rounded-3xl border px-6 py-6 shadow-sm sm:grid-cols-3 sm:px-10"
	>
		<div>
			<p class="font-brand text-3xl leading-none tracking-tight sm:text-4xl">50.000+</p>
			<p class="text-base-content/75 mt-1.5 text-sm leading-snug">Events insgesamt – auf Blissbase ist wirklich was los</p>
		</div>
		<div>
			<p class="font-brand text-3xl leading-none tracking-tight sm:text-4xl">5.300+</p>
			<p class="text-base-content/75 mt-1.5 text-sm leading-snug">anstehende Events – hier stöbern Menschen nach ihrem nächsten Termin</p>
		</div>
		<div>
			<p class="font-brand text-3xl leading-none tracking-tight sm:text-4xl">DACH & Hotspots</p>
			<p class="text-base-content/75 mt-1.5 text-sm leading-snug">Deutschland, Österreich, Schweiz, Indonesien, Thailand & Vietnam</p>
		</div>
		<p class="text-base-content/65 border-base-200 border-t pt-4 text-xs sm:col-span-3">
			Stand November 2026 ·
			<a href={routes.faq()} class="link link-hover font-medium">Aktuelle Zahlen pro Land ansehen</a>
		</p>
	</section>

	<section aria-labelledby="hosts-benefits-heading">
		<div class="mb-7 max-w-2xl">
			<h2 id="hosts-benefits-heading" class="font-brand text-3xl tracking-tight sm:text-4xl">Warum Hosts gern auf Blissbase teilen</h2>
			<p class="text-base-content/75 mt-2 leading-relaxed">
				Gebaut für Menschen, die Räume halten – nicht für Marketing-Abteilungen. Wenig Aufwand, volle Kontrolle über deine Buchungen.
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2 sm:gap-5">
			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-3 p-6">
					<span class="bg-primary/20 text-primary-content flex size-11 items-center justify-center rounded-2xl">
						<i aria-hidden="true" class="icon-[ph--image] size-6"></i>
					</span>
					<h3 class="card-title text-lg leading-snug">In Minuten online – dein Flyer reicht</h3>
					<p class="text-base-content/80 text-sm leading-relaxed sm:text-base">
						Lad deinen Flyer hoch oder kopier deinen Ausschreibungstext rein. Blissbase füllt Titel, Datum, Ort und passende Tags
						automatisch für dich aus – kurz drüberschauen, veröffentlichen, fertig.
					</p>
				</div>
			</article>

			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-3 p-6">
					<span class="bg-primary/20 text-primary-content flex size-11 items-center justify-center rounded-2xl">
						<i aria-hidden="true" class="icon-[ph--link-simple] size-6"></i>
					</span>
					<h3 class="card-title text-lg leading-snug">Anmeldung & Preise bleiben ganz bei dir</h3>
					<p class="text-base-content/80 text-sm leading-relaxed sm:text-base">
						Ob persönlich per WhatsApp, Telegram, E-Mail oder über deine eigene Ticketseite: Hinterleg einfach deinen gewohnten Weg. Keine
						Gebühren, keine Provision – deine Gäste landen direkt bei dir.
					</p>
				</div>
			</article>

			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-3 p-6">
					<span class="bg-primary/20 text-primary-content flex size-11 items-center justify-center rounded-2xl">
						<i aria-hidden="true" class="icon-[ph--heart] size-6"></i>
					</span>
					<h3 class="card-title text-lg leading-snug">Ein Profil für alles, was du anbietest</h3>
					<p class="text-base-content/80 text-sm leading-relaxed sm:text-base">
						Aus einem guten Abend werden oft Stammgäste. Auf deiner kostenlosen Profilseite finden Menschen deine nächsten Termine, deine
						1:1-Angebote sowie Website und Socials – übersichtlich an einem Ort.
					</p>
				</div>
			</article>

			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-3 p-6">
					<span class="bg-primary/20 text-primary-content flex size-11 items-center justify-center rounded-2xl">
						<i aria-hidden="true" class="icon-[ph--paper-plane-tilt] size-6"></i>
					</span>
					<h3 class="card-title text-lg leading-snug">Oder einfach per Telegram schicken</h3>
					<p class="text-base-content/80 text-sm leading-relaxed sm:text-base">
						Du postest deine Events sowieso in Telegram-Gruppen? Schick Bild, Beschreibung, Ort und Datum zusammen in einer Nachricht an
						<a href="https://t.me/blissbase_bot" target="_blank" rel="noopener noreferrer" class="link font-semibold">@blissbase_bot</a>
						– fertig.
					</p>
				</div>
			</article>
		</div>
	</section>

	<section aria-labelledby="hosts-steps-heading" class="bg-base-100 border-base-300/70 rounded-3xl border p-6 shadow-sm sm:p-10">
		<div class="mb-7 max-w-xl">
			<h2 id="hosts-steps-heading" class="font-brand text-3xl tracking-tight sm:text-4xl">In drei Schritten live</h2>
			<p class="text-base-content/75 mt-2 leading-relaxed">
				Du brauchst kein Konto im Voraus – du kannst direkt loslegen und dein Event in einem Rutsch veröffentlichen.
			</p>
		</div>

		<ol class="grid gap-6 md:grid-cols-3">
			<li class="border-base-300/80 flex flex-col gap-2 border-t pt-5">
				<span class="font-brand text-primary-content bg-primary/20 inline-flex w-fit rounded-full px-3 py-0.5 text-sm">Schritt 1</span>
				<h3 class="mt-1 text-lg leading-snug">Flyer oder Text einfügen</h3>
				<p class="text-base-content/80 text-sm leading-relaxed">
					Mit „Automatisch ausfüllen“ zieht Blissbase Titel, Zeiten, Ort und Tags direkt aus deinem Flyer oder Ankündigungstext.
				</p>
			</li>

			<li class="border-base-300/80 flex flex-col gap-2 border-t pt-5">
				<span class="font-brand text-primary-content bg-primary/20 inline-flex w-fit rounded-full px-3 py-0.5 text-sm">Schritt 2</span>
				<h3 class="mt-1 text-lg leading-snug">Buchungsweg hinterlegen</h3>
				<p class="text-base-content/80 text-sm leading-relaxed">
					Verlink deine Ticketseite, Website, WhatsApp, Telegram oder E-Mail – so melden sich Gäste genau dort an, wo du sie haben willst.
				</p>
			</li>

			<li class="border-base-300/80 flex flex-col gap-2 border-t pt-5">
				<span class="font-brand text-primary-content bg-primary/20 inline-flex w-fit rounded-full px-3 py-0.5 text-sm">Schritt 3</span>
				<h3 class="mt-1 text-lg leading-snug">Bestätigen & gefunden werden</h3>
				<p class="text-base-content/80 text-sm leading-relaxed">
					Kurz per Google oder E-Mail-Code bestätigen – dein Event ist sofort in der Suche und auf deiner öffentlichen Profilseite live.
				</p>
			</li>
		</ol>

		<p class="text-base-content/70 border-base-200 mt-7 border-t pt-5 text-sm">
			Du möchtest ein Event nur im kleinen Kreis teilen? Im Formular kannst du es auch auf „Nicht in der Suche anzeigen“ stellen und nur per
			Direktlink weitergeben.
		</p>
	</section>

	<section aria-label="Nachricht vom Gründer" class="bg-primary/12 border-primary/25 rounded-3xl border p-6 sm:p-10">
		<div class="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
			<img src="/me.jpg" width="64" height="64" alt="Sam, Gründer von Blissbase" class="size-16 rounded-full object-cover shadow-sm" />
			<div>
				<blockquote class="font-brand text-2xl leading-snug tracking-tight sm:text-3xl">
					„Gute Events verschwinden viel zu oft in irgendwelchen WhatsApp-Gruppen oder Instagram-Stories. Ich baue Blissbase, damit deine
					Arbeit nicht untergeht – und genau die Menschen zu dir finden, die wirklich Lust darauf haben. Schön, wenn du dabei bist.“
				</blockquote>
				<div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
					<p>
						<strong>Sam</strong>
						<span class="text-base-content/70"> · Gründer von Blissbase</span>
					</p>
					<a href={routes.about()} class="link link-hover text-base-content/80 font-medium">Mehr über die Idee hinter Blissbase</a>
				</div>
			</div>
		</div>
	</section>

	<section aria-labelledby="hosts-faq-heading">
		<h2 id="hosts-faq-heading" class="font-brand mb-6 text-3xl tracking-tight">Kurz geklärt</h2>
		<div class="grid gap-4 md:grid-cols-3">
			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-2 p-6">
					<h3 class="text-base leading-snug">Kostet mich das wirklich nichts?</h3>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Ja. Events eintragen, ein öffentliches Profil anlegen und 1:1-Angebote listen ist komplett kostenlos. Wir nehmen keine Provision
						auf deine Tickets.
					</p>
				</div>
			</article>

			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-2 p-6">
					<h3 class="text-base leading-snug">Welche Events passen auf Blissbase?</h3>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Alles rund um bewusstes Erleben, Bewegung und echte Begegnung: Ecstatic Dance, Breathwork, Yoga, Sound Healing, Zeremonien,
						Workshops, Retreats und Community-Treffen – vor Ort oder online.
					</p>
				</div>
			</article>

			<article class="card bg-base-100 border-base-300/70 border shadow-sm">
				<div class="card-body gap-2 p-6">
					<h3 class="text-base leading-snug">Ich biete vor allem 1:1-Sessions an – geht das?</h3>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Klar. Coaching, Bodywork, Massagen oder andere Einzelsessions kannst du dauerhaft unter
						<a href={routes.newOffering()} class="link font-semibold">Angebote</a>
						eintragen – sichtbar in der Suche und auf deinem Profil.
					</p>
				</div>
			</article>
		</div>
	</section>

	<section class="bg-base-100 border-base-300/70 rounded-3xl border p-7 shadow-sm sm:p-10">
		<div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
			<div class="max-w-lg">
				<h2 class="font-brand text-3xl tracking-tight sm:text-4xl">Lust, dein nächstes Event zu teilen?</h2>
				<p class="text-base-content/75 mt-2 leading-relaxed">
					In wenigen Minuten online – kostenlos, ohne Provision und direkt bei Menschen, die genau danach suchen.
				</p>
			</div>
			<div class="flex shrink-0 flex-wrap items-center gap-3">
				<a class="btn btn-primary btn-lg rounded-full px-7" href={routes.newEvent()} data-testid="hosts-create-event-bottom">
					Jetzt kostenlos eintragen
					<i aria-hidden="true" class="icon-[ph--arrow-right-bold] size-4"></i>
				</a>
				<a
					class="btn btn-outline border-base-300 bg-base-100 hover:bg-base-200 hover:border-base-300 rounded-full px-5"
					href={routes.root()}
				>
					Erst mal stöbern
				</a>
			</div>
		</div>
	</section>
</div>

<style>
	.hosts-event-card-preview :global {
		[data-testid="event-card"] > div {
			flex-direction: column;
		}

		[data-event-image-column] {
			width: 100%;
			border-radius: 0.5rem 0.5rem 0 0;
		}

		[data-event-image-column] > div:last-child {
			position: static;
			border-radius: 0.5rem 0.5rem 0 0;
		}

		[data-event-image-column] figure {
			border-radius: 0.5rem 0.5rem 0 0;
		}

		[data-event-image-column] img {
			max-height: 18rem;
		}

		[data-event-card-body] {
			padding-top: 1.125rem;
		}
	}
</style>
