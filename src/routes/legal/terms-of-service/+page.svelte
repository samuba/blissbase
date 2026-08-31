<script lang="ts">
	import { BASE_URL, absoluteUrl, routes } from "$lib/routes";

	const termsOfServiceUrl = absoluteUrl(routes.termsOfService());
</script>

<svelte:head>
	<title>Nutzungsbedingungen / Terms of Service | Blissbase</title>
	<meta
		name="description"
		content="Nutzungsbedingungen für Blissbase, einschließlich Konten, Google Sign-In und Nutzerinhalten."
	/>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-4 md:py-0 md:pb-16">
	<div class="card bg-base-100 p-6 shadow prose">
		<h1>
			<!-- @wc-include -->
			Nutzungsbedingungen / AGB
		</h1>
		<!-- @wc-ignore -->
		<article class="max-w-none" data-testid="terms-of-service">
			<p class="text-base-content/70 text-sm">Stand / Last updated: 27. August 2026</p>
			<p>
				Die deutsche Fassung ist rechtlich maßgeblich. The German version is legally binding; the English text is
				a convenience translation.
			</p>
			<p>
				<a href="#de" class="link">Deutsch</a>
				·
				<a href="#en" class="link">English</a>
			</p>

			<section>
				<h2>Google Sign-In</h2>
				<p>
					You can create and use a Blissbase account with Google Sign-In or with an email code. Google Sign-In is
					optional. Browsing events does not require a Google account. How we handle Google user data is described
					in the
					<a href={routes.privacyPolicy()} class="link">Privacy Policy</a>, including the Limited Use requirements
					of the Google API Services User Data Policy.
				</p>
			</section>

			<div class="divider"></div>

			<section id="de">
				<h2>Nutzungsbedingungen (Deutsch)</h2>

				<h3>1. Anbieter</h3>
				<p>
					Blissbase wird betrieben von Samuel, Deutschland. Kontakt:
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. Website:
					<a href={BASE_URL} class="link">blissbase.app</a>. Eine Postanschrift teilen wir auf Anfrage mit.
				</p>

				<h3>2. Geltungsbereich</h3>
				<p>
					Diese Bedingungen gelten für die Nutzung von Blissbase im Internet. Sie richten sich an Verbraucher:innen
					im Sinne von § 13 BGB und, soweit Unternehmer:innen die Plattform nutzen, auch an diese. Zwingende
					Verbraucherschutzvorschriften deines Wohnsitzstaates bleiben unberührt.
				</p>

				<h3>3. Leistungsbeschreibung</h3>
				<p>
					Blissbase ist eine kostenlose Plattform, um achtsame Events und Angebote zu entdecken und zu teilen. Die
					Nutzung der Suche und der Eventliste ist ohne Registrierung möglich. Bestimmte Funktionen (Favoriten,
					eigenes Profil, eigene Events und Angebote) setzen ein Konto voraus.
				</p>
				<p>
					Blissbase vermittelt keine Verträge zwischen dir und Veranstalter:innen. Anmeldung, Zahlung und
					Teilnahme an einem Event liegen allein bei dir und der jeweiligen Veranstaltung. Angaben zu Events
					(Zeiten, Preise, Orte) sind unverbindlich, soweit nicht ausdrücklich etwas anderes gesagt wird.
				</p>

				<h3>4. Konto und Google Sign-In</h3>
				<p>
					Ein Konto kannst du per E-Mail-Code oder über Google Sign-In erstellen. Google Sign-In ist freiwillig.
					Du musst wahre Angaben machen und deine Zugangsdaten bzw. dein Google-Konto schützen. Blissbase richtet
					sich an Personen ab 16 Jahren.
				</p>
				<p>
					Wir dürfen Konten sperren oder löschen, wenn diese Bedingungen verletzt werden, Missbrauch vorliegt oder
					es für den sicheren Betrieb nötig ist. Du kannst die Löschung deines Kontos jederzeit per E-Mail an
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a> verlangen.
				</p>

				<h3>5. Deine Inhalte</h3>
				<p>
					Für Events, Angebote, Profiltexte und Bilder, die du hochlädst, bleibst du verantwortlich. Du sicherst
					zu, dass du die Rechte daran hast und keine Rechte Dritter oder geltendes Recht verletzt.
				</p>
				<p>
					Du räumst uns eine nicht-ausschließliche, weltweite, unentgeltliche Lizenz ein, diese Inhalte auf
					Blissbase zu hosten, anzuzeigen und technisch zu vervielfältigen, soweit das für den Betrieb und die
					Darstellung der Plattform nötig ist. Die Lizenz endet, wenn du die Inhalte löschst oder uns zur
					Entfernung aufforderst, außer soweit Kopien in Backups oder Caches noch kurzfristig existieren.
				</p>

				<h3>6. Inhalte Dritter und Meldeweg</h3>
				<p>
					Ein Teil der Events stammt aus öffentlich zugänglichen Websites, Kalendern und Community-Kanälen. Wir
					bemühen uns um Richtigkeit, übernehmen aber keine Gewähr für Vollständigkeit, Zeiten, Preise, Ausfälle
					oder die Qualität einer Veranstaltung. Prüfe wichtige Angaben immer bei der Quelle bzw. den
					Veranstalter:innen.
				</p>
				<p>
					Für rechtswidrige Inhalte Dritter haften wir nach den Regeln des Digital Services Act und des DDG
					grundsätzlich erst, wenn wir Kenntnis davon haben und nicht unverzüglich tätig werden. Hinweise auf
					rechtswidrige Inhalte bitte an
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.
				</p>

				<h3>7. Erlaubte Nutzung</h3>
				<p>Du darfst Blissbase nicht nutzen, um:</p>
				<ul>
					<li>rechtswidrige, belästigende, diskriminierende oder irreführende Inhalte zu veröffentlichen,</li>
					<li>Schadsoftware zu verbreiten oder die Infrastruktur anzugreifen,</li>
					<li>
						Daten anderer Nutzer:innen ohne Erlaubnis auszulesen (Scraping über das übliche Browsen hinaus,
						automatisierte Massenabfragen),
					</li>
 					<li>Spam, Fake-Events oder Werbung zu platzieren, die nichts mit achtsamen Events oder Angeboten zu tun hat.</li>
				</ul>

				<h3>8. Kosten</h3>
				<p>
					Die Nutzung von Blissbase ist derzeit kostenlos. Wir können in Zukunft optionale kostenpflichtige
					Funktionen einführen; das würden wir klar kennzeichnen und — soweit gesetzlich nötig — über Widerruf und
					Preise gesondert informieren. Es besteht kein Anspruch darauf, dass Blissbase dauerhaft unentgeltlich
					bleibt.
				</p>

				<h3>9. Verfügbarkeit</h3>
				<p>
					Wir bemühen uns um einen zuverlässigen Betrieb. Wartung, Fehler, höhere Gewalt oder Änderungen bei
					Drittanbietern (z. B. Google, Hosting) können die Verfügbarkeit einschränken. Ein Anspruch auf
					ununterbrochenen Betrieb besteht nicht. Gesetzliche Rechte, insbesondere bei Pflichtverletzungen, bleiben
					unberührt.
				</p>

				<h3>10. Haftung</h3>
				<p>
					Wir haften unbeschränkt bei Vorsatz, grober Fahrlässigkeit, Verletzung des Lebens, des Körpers oder der
					Gesundheit sowie nach dem Produkthaftungsgesetz. Bei leicht fahrlässiger Verletzung wesentlicher
					Vertragspflichten ist die Haftung auf den vorhersehbaren, vertragstypischen Schaden begrenzt. Im Übrigen
					ist die Haftung ausgeschlossen, soweit gesetzlich zulässig.
				</p>
				<p>
					Für Inhalte Dritter (Veranstalter:innen, verlinkte Websites, übernommene Kalender) sind wir nicht
					verantwortlich, sobald wir Kenntnis von Rechtsverletzungen haben und diese entfernen.
				</p>

				<h3>11. Datenschutz</h3>
				<p>
					Wie wir personenbezogene Daten verarbeiten – einschließlich der Daten aus der Google-Anmeldung – steht in
					der
					<a href={routes.privacyPolicy()} class="link">Datenschutzerklärung</a>.
				</p>

				<h3>12. Änderungen dieser Bedingungen</h3>
				<p>
					Wir können diese Nutzungsbedingungen anpassen, wenn sich der Dienst oder die Rechtslage ändert. Die
					aktuelle Fassung gilt ab Veröffentlichung unter
					<a href={routes.termsOfService()} class="link">{termsOfServiceUrl}</a>. Bei wesentlichen
					Änderungen informieren wir, soweit zumutbar, auf der Website oder per E-Mail. Widersprichst du den
					Änderungen, kannst du die Nutzung einstellen und die Löschung deines Kontos verlangen.
				</p>

				<h3>13. Anwendbares Recht und Streitbeilegung</h3>
				<p>
					Es gilt das Recht der Bundesrepublik Deutschland. Zwingende Verbraucherschutzvorschriften deines
					Wohnsitzstaates bleiben unberührt. Für Verbraucher:innen gilt der gesetzliche Gerichtsstand. Ist eine
					Klausel unwirksam, bleibt der Rest wirksam.
				</p>
				<p>
					Wir sind weder verpflichtet noch bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
					teilzunehmen.
				</p>

				<h3>14. Kontakt</h3>
				<p>Fragen zu diesen Bedingungen: <a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.</p>
			</section>

			<div class="divider"></div>

			<section id="en">
				<h2>Terms of Service (English)</h2>
				<p>If the German and English texts differ, the German version prevails.</p>

				<h3>1. Provider</h3>
				<p>
					Blissbase is operated by Samuel, Germany. Contact:
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. Website:
					<a href={BASE_URL} class="link">blissbase.app</a>. A postal address is available on request.
				</p>

				<h3>2. Scope</h3>
				<p>
					These terms govern use of Blissbase. They apply to consumers and, where businesses use the platform, to
					those businesses. Mandatory consumer-protection rules of your country of residence still apply.
				</p>

				<h3>3. The service</h3>
				<p>
					Blissbase is a free platform to discover and share mindful events and offerings. Search and the event
					list work without an account. Favorites, a public profile, and publishing your own events or offerings
					require an account. Blissbase does not broker contracts with organizers. Registration, payment, and
					attendance are solely between you and the organizer.
				</p>

				<h3>4. Account and Google Sign-In</h3>
				<p>
					You may create an account with an email code or Google Sign-In. Google Sign-In is optional. You must
					provide accurate information and protect your credentials or Google account. Blissbase is for people aged
					16 and over. We may suspend or delete accounts for breach, abuse, or to keep the service safe. You may
					ask us to delete your account at any time.
				</p>

				<h3>5. Your content</h3>
				<p>
					You remain responsible for events, offerings, profile text, and images you upload, and you warrant that
					you have the rights and do not infringe law or third-party rights. You grant us a non-exclusive,
					worldwide, royalty-free license to host, display, and technically reproduce that content as needed to
					operate and display Blissbase. The license ends when you delete the content or ask us to remove it,
					except for short-lived backup or cache copies.
				</p>

				<h3>6. Third-party content</h3>
				<p>
					Some events come from public websites, calendars, and community channels. We try to be accurate but do
					not warrant completeness, times, prices, cancellations, or quality. Check important details with the
					source or organizer. Report illegal content to
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. Under the Digital Services Act we
					generally act once we have knowledge of illegal hosted content.
				</p>

				<h3>7. Acceptable use</h3>
				<p>
					Do not use Blissbase to post unlawful, harassing, discriminatory, or misleading content; spread malware
					or attack the infrastructure; scrape or bulk-extract other users’ data beyond ordinary browsing; or post
					spam, fake events, or unrelated advertising.
				</p>

				<h3>8. Fees</h3>
				<p>
					Blissbase is currently free. We may later introduce optional paid features, which we would label clearly
					and, where required, explain withdrawal and pricing separately. There is no right to free use forever.
				</p>

				<h3>9. Availability</h3>
				<p>
					We aim for reliable operation. Maintenance, faults, force majeure, or changes at providers (for example
					Google or hosting) may limit availability. There is no right to uninterrupted operation. Statutory
					rights for breach of duty remain unaffected.
				</p>

				<h3>10. Liability</h3>
				<p>
					We are fully liable for intent, gross negligence, injury to life, body, or health, and under the German
					Product Liability Act. For slightly negligent breach of essential contractual duties, liability is
					limited to foreseeable, typical damage. Otherwise liability is excluded to the extent permitted by law.
				</p>

				<h3>11. Privacy</h3>
				<p>
					How we process personal data, including Google Sign-In data, is set out in the
					<a href={routes.privacyPolicy()} class="link">Privacy Policy</a>.
				</p>

				<h3>12. Changes</h3>
				<p>
					We may update these terms if the service or the law changes. The current version applies from publication
					at
					<a href={routes.termsOfService()} class="link">{termsOfServiceUrl}</a>. For material
					changes we will inform you on the site or by email where reasonable. If you object, you may stop using
					Blissbase and ask us to delete your account.
				</p>

				<h3>13. Governing law and disputes</h3>
				<p>
					German law applies. Mandatory consumer-protection rules of your country of residence remain unaffected.
					Consumers keep the statutory place of jurisdiction. If a clause is invalid, the rest stays in effect. We
					are neither obliged nor willing to participate in dispute-resolution proceedings before a consumer
					arbitration board.
				</p>

				<h3>14. Contact</h3>
				<p>Questions: <a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.</p>
			</section>
		</article>
	</div>
</div>
