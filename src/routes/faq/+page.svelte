<script lang="ts">
    /* @wc-include */
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

		{#each faqs as faq (faq.question)}
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
