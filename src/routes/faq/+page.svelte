<script lang="ts">
    /* @wc-include */
	import { getFaqRecentEventCounts } from '$lib/rpc/eventCount.remote';

	const faqRecentEventCounts = await getFaqRecentEventCounts();

	const faqs = [
		{
			question: `Was ist Blissbase?`,
			answer: `Blissbase ist die App in der du alle achtsamen Events an einem Ort komfortabel findest. Egal ob Ecstatic Dance, Workshops, Festivals oder Community-Treffen.`
		},
		{
			question: `Woher kommen die Events?`,
			answer: `Von Blissbase Usern die ihre Events hier teilen und aus verschiedenen öffentlichen Quellen. Ziel dabei ist es, die achtsamen Communities sichtbarer und zugänglicher zu machen.`
		},
		{
			question: `Kann ich selbst ein Event eintragen?`,
			answer: `Ja. Über 'Erstellen' kannst du eigene Events hinzufügen, sobald du angemeldet bist.`
		},
		{
			question: `Kostet die Nutzung etwas?`,
			answer: `Nein, das Nutzen von Blissbase ist kostenlos.`
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
					Du kannst Blissbase weltweit nutzen aber unsere zur Zeit am besten unterstützten Regionen siehst du hier, mit der Anzahl <b>neuer Events der letzten zwei Monate</b>.
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
