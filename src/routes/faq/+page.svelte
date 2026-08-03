<script lang="ts">
	/* @wc-include */
	import { routes } from '$lib/routes';

	let { data } = $props();
	const faqRecentEventCounts = $derived(data.faqRecentEventCounts);

	const faqs = [
		{
			question: `Was ist Blissbase?`,
			answer: `Blissbase ist die App, in der du alle achtsamen Events an einem Ort findest – Ecstatic Dance, Workshops, Festivals, Community-Treffen und mehr.`
		},
		{
			question: `Kostet die Nutzung etwas?`,
			answer: `Nein. Blissbase zu nutzen ist kostenlos.`
		},
		{
			question: `Wie kann ich Feedback schicken oder Hallo sagen?`,
			answer: `Am einfachsten per Mail an hi@blissbase.app. Ich freue mich über jedes Feedback, Ideen, Korrekturen und Kooperationen.`
		}
	] as const;
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-6">
	<div class="flex flex-col gap-4">
		<div class="card bg-base-100 p-6 shadow">
			<h1 class="text-2xl font-semibold">FAQ</h1>
			<p class="mt-2 text-base-content/75">
				Antworten auf die häufigsten Fragen rund um Blissbase.
			</p>
		</div>

		{#each faqs.slice(0, 1) as faq (faq.question)}
			<div class="card bg-base-100 p-6 shadow">
				<h2 class="text-lg font-semibold">{faq.question}</h2>
				<p class="mt-2 text-base-content/80">{faq.answer}</p>
			</div>
		{/each}

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
			<h2 class="text-lg font-semibold">Woher kommen die Events?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Von Veranstalter:innen, die ihre Termine direkt auf Blissbase teilen – und aus
					öffentlichen Kalendern, Websites und Community-Kanälen. So bleibt die achtsame Szene
					sichtbar, ohne dass du zehn Apps und Gruppen durchforsten musst.
				</p>
				<p>
					Die vollständige Liste findest du unter
					<a href={routes.sources()} class="link font-semibold">Event-Quellen</a>.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Wie kann ich selbst ein Event eintragen?</h2>
			<div class="mt-2 space-y-4 text-base-content/80">
				<p>
					Am einfachsten über <a href={routes.newEvent()} class="link font-semibold">Event hinzufügen</a> auf der Startseite.
				</p>

				<div class="space-y-2">
					<p class="font-medium text-base-content">Weitere Wege:</p>
					<ul class="list-disc space-y-2 pl-5">
						<li>
							<b>Telegram-Bot:</b> Schick deinen Event an
							<a
								href="https://t.me/blissbase_bot"
								target="_blank"
								rel="noopener noreferrer"
								class="link font-semibold">@blissbase_bot</a
							>.
							Wichtig: Beschreibung, Ort, Datum und Bild müssen in
							<b>einer einzigen Nachricht</b> stehen.
						</li>
						<li>
							<b>Über eine Event-Quelle:</b> Trag deinen Termin auf einer der gelisteten Websites
							oder in einem Community-Kanal ein. Ich hole diese Quellen mehrmals täglich ab – nach
							ein paar Stunden solltest du dein Event hier sehen. Alle Quellen findest du unter
							<a href={routes.sources()} class="link font-semibold">Event-Quellen</a>.
						</li>
					</ul>
				</div>
			</div>
		</div>

		{#each faqs.slice(1) as faq (faq.question)}
			<div class="card bg-base-100 p-6 shadow">
				<h2 class="text-lg font-semibold">{faq.question}</h2>
				<p class="mt-2 text-base-content/80">{faq.answer}</p>
			</div>
		{/each}

		<div class="card bg-base-100 p-6 shadow">
			<p>
				Deine Frage ist nicht dabei?
				<a href="mailto:hi@blissbase.app" class="link ml-1 font-semibold">Schreib mir.</a>
			</p>
		</div>
	</div>
</div>
