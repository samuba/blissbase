<script lang="ts">
	import { BASE_URL, absoluteUrl, routes } from "$lib/routes";

	const privacyPolicyUrl = absoluteUrl(routes.privacyPolicy());
</script>

<svelte:head>
	<title>Privacy Policy / Datenschutzerklärung | Blissbase</title>
	<meta
		name="description"
		content="Wie Blissbase personenbezogene Daten verarbeitet, einschließlich Google Sign-In (Zugriff, Nutzung, Speicherung und Weitergabe)."
	/>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-4 md:py-0 md:pb-16">
	<div class="card bg-base-100 p-6 shadow prose">
		<h1>
			<!-- @wc-include -->
			Datenschutzerklärung
		</h1>

		<!-- @wc-ignore -->
		<article class=" max-w-none" data-testid="privacy-policy">
			<p class="text-base-content/70 text-sm">Stand / Last updated: 27. August 2026</p>
			<p>
				Die deutsche Fassung ist rechtlich maßgeblich. The German version is legally binding; the English text is
				a convenience translation for international users and Google OAuth review.
			</p>
			<p>
				<a href="#de" class="link">Deutsch</a>
				·
				<a href="#en" class="link">English</a>
				·
				<a href="#google-user-data" class="link">Google user data</a>
			</p>

			<section id="google-user-data">
				<h2>Google Sign-In: how we access, use, store, and share Google user data</h2>
				<p>
					Blissbase uses Google Sign-In (OAuth 2.0, via our authentication provider) as an optional way to create
					and log into an account. We request only the basic Google profile information needed to sign you in:
					<code>openid</code>, <code>email</code>, and <code>profile</code>. We do not request Gmail, Drive,
					Calendar, Contacts, or other sensitive or restricted Google scopes.
				</p>
				<p><strong>Access.</strong> When you choose “Mit Google anmelden” / “Sign in with Google”, Google shows a consent screen. After you approve, Blissbase receives:</p>
				<ul>
					<li>your Google account email address,</li>
					<li>your name, and</li>
					<li>your Google profile picture URL, if your Google account has one.</li>
				</ul>
				<p>
					<strong>Use.</strong> We use this Google user data solely to create or recognize your Blissbase account,
					log you in, and pre-fill your display name. You can change the name later. A Google profile picture is
					not copied onto a public Blissbase profile unless you upload a photo yourself. We do not use Google
					user data to serve ads, for retargeting or interest-based advertising, to train AI or machine-learning
					models, to determine credit-worthiness, or to sell or build profiles about you for third parties.
				</p>
				<p>
					<strong>Store.</strong> Email and account identifiers are stored in our database for as long as your
					account exists. A display name taken from Google is stored on your Blissbase profile until you change or
					delete it. We never receive or store your Google password. Authentication tokens are handled by our auth
					provider.
				</p>
				<p>
					<strong>Share.</strong> We do not sell Google user data. We do not transfer it to data brokers or
					advertising platforms. We share it only with processors that operate Blissbase (authentication and
					database, hosting, and — if you are signed in — product analytics that may receive email and display
					name as account identifiers). Humans at Blissbase do not read Google user data except as needed for
					security, to handle a support request you make, or to comply with law.
				</p>
				<p>
					<strong>Limited Use.</strong> Blissbase's use of information received from Google APIs will adhere to the
					<a
						href="https://developers.google.com/terms/api-services-user-data-policy"
						class="link"
						target="_blank"
						rel="noopener noreferrer">Google API Services User Data Policy</a
					>, including the Limited Use requirements.
				</p>
				<p>
					You can revoke Blissbase’s access to your Google Account at
					<a
						href="https://myaccount.google.com/permissions"
						class="link"
						target="_blank"
						rel="noopener noreferrer">myaccount.google.com/permissions</a
					>. Revoking access does not automatically delete your Blissbase account. To delete your account and
					related personal data, email
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.
				</p>
			</section>

			<div class="divider"></div>

			<section id="de">
				<h2>Datenschutzerklärung (Deutsch)</h2>

				<h3>1. Verantwortlicher</h3>
				<p>
					Verantwortlich für die Verarbeitung personenbezogener Daten auf
					<a href={BASE_URL} class="link">blissbase.app</a>
					(„Blissbase“, „wir“) im Sinne der DSGVO ist:
				</p>
				<p>
					Samuel Bach<br />
					Deutschland<br />
					E-Mail: <a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>
				</p>
				<p>
					Eine Postanschrift teilen wir auf Anfrage unter derselben E-Mail mit. Es ist kein Datenschutzbeauftragter
					bestellt, weil dazu keine gesetzliche Pflicht besteht.
				</p>

				<h3>2. Worum geht es bei Blissbase?</h3>
				<p>
					Blissbase ist eine kostenlose Web-App, um achtsame Events, Retreats, Workshops, Community-Treffen und
					Angebote (z. B. Ecstatic Dance, Yoga, Meditation) zu finden, zu speichern und selbst einzutragen. Du
					kannst Blissbase ohne Konto durchstöbern. Ein Konto brauchst du, um Favoriten zu speichern, ein
					öffentliches Profil anzulegen oder eigene Events und Angebote zu veröffentlichen.
				</p>

				<h3>3. Welche Daten wir verarbeiten</h3>
				<ul>
					<li>
						Kontodaten: E-Mail-Adresse, Anzeigename, optionales Profilbild, optionale Bio, Standortangabe,
						Social-Links und öffentliche Profil-URL.
					</li>
					<li>Inhalte, die du selbst anlegst: Events, Angebote, Bilder, Favoriten.</li>
					<li>
						Nutzungsdaten: aufgerufene Seiten, grobe ungefähre Lage über den Zugangsprovider (siehe Abschnitt 8),
						Gerätetyp und Sprache.
					</li>
					<li>
						Technische Daten: IP-Adresse, Browser, Zeitstempel, Cookies bzw. vergleichbare Speicherung (siehe
						Abschnitt 10).
					</li>
				</ul>

				<h3>4. Google-Anmeldung (Google Sign-In)</h3>
				<p>
					Die englische Zusammenfassung oben („Google user data“) gilt auch hier. Kurz: Du kannst dich optional
					mit Google anmelden. Dafür erhalten wir von Google nur E-Mail-Adresse, Namen und ggf. die URL des
					Profilbilds. Diese Daten nutzen wir ausschließlich zum Anlegen bzw. Wiedererkennen deines Kontos, zum
					Login und zum Vorbelegen des Anzeigenamens. Wir verkaufen keine Google-Nutzerdaten, nutzen sie nicht
					für Werbung und nicht zum Trainieren von KI-Modellen.
				</p>
				<p>
					Rechtsgrundlage für die Kontoführung ist Art. 6 Abs. 1 lit. b DSGVO (Vertrag / vorvertragliche
					Maßnahmen). Die Einwilligung gegenüber Google auf dem Google-Consent-Screen ist zusätzlich Googles
					eigene Verarbeitung.
				</p>
				<p>
					Die Nutzung von Informationen, die wir über Google-APIs erhalten, entspricht der
					<a
						href="https://developers.google.com/terms/api-services-user-data-policy"
						class="link"
						target="_blank"
						rel="noopener noreferrer">Google API Services User Data Policy</a
					>, einschließlich der Limited-Use-Vorgaben.
				</p>

				<h3>5. Anmeldung per E-Mail</h3>
				<p>
					Alternativ kannst du dich mit E-Mail und Einmalcode anmelden. Dafür speichern wir deine E-Mail-Adresse
					und senden dir einen Login-Code bzw. einen Magic Link. Diese E-Mails dienen nur der Anmeldung
					(Rechtsgrundlage Art. 6 Abs. 1 lit. b DSGVO).
				</p>

				<h3>6. Profil, Events und Angebote</h3>
				<p>
					Wenn du ein öffentliches Profil, Events oder Angebote anlegst, sind die von dir veröffentlichten Angaben
					(Name, Beschreibung, Bilder, Ort, Kontaktwege) für andere Nutzer:innen von Blissbase sichtbar. Private
					Favoriten sind nur für dich sichtbar. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
				</p>
				<p>
					Events können außerdem aus öffentlich zugänglichen Kalendern, Websites und Community-Kanälen übernommen
					werden. Dabei speichern wir die öffentlich gemachten Eventdaten (Titel, Zeit, Ort, Beschreibung, Bilder,
					Quelle). Soweit dabei personenbezogene Daten Dritter enthalten sind, stützen wir uns auf Art. 6 Abs. 1
					lit. f DSGVO (berechtigtes Interesse an einem öffentlichen Eventkalender) und Art. 14 DSGVO (Daten nicht
					bei der betroffenen Person erhoben). Du kannst uns um Löschung oder Anonymisierung bitten.
				</p>

				<h3>7. Standortdaten und Google Maps / Places</h3>
				<p>
					Wenn du nach Events in deiner Nähe suchst oder einen Ort einträgst, nutzen wir Google Maps und Google
					Places (Autovervollständigung, Geocoding). Dabei werden deine Sucheingaben bzw. Koordinaten an Google
					gesendet, damit wir Ortsvorschläge und Entfernungen anzeigen können. Das ist unabhängig von der
					Google-Anmeldung: Für die Ortssuche brauchen wir kein Google-Konto von dir. Rechtsgrundlage: Art. 6
					Abs. 1 lit. b bzw. lit. f DSGVO.
				</p>
				<p>
					Wenn du dem Browser erlaubst, deinen Standort zu teilen, verwenden wir die groben Koordinaten nur, um
					Events in der Nähe vorzuschlagen. Wir speichern deinen Live-Standort nicht dauerhaft als
					Bewegungsprofil. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung über die
					Browser-Berechtigung) sowie § 25 TDDDG.
				</p>

				<h3>8. Ungefähre Lage über den Internetzugang</h3>
				<p>
					Unser Hosting-Anbieter kann aus der IP-Adresse grobe Angaben ableiten (Land, Region, Stadt, ungefähre
					Koordinaten). Wenn du noch keinen Ort gewählt hast, können wir damit Events in der Nähe vorschlagen. Das
					ist kein GPS und kein Bewegungsprofil. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
				</p>

				<h3>9. Analyse (PostHog)</h3>
				<p>
					Damit Blissbase stabil bleibt und wir verstehen, welche Funktionen helfen, nutzen wir PostHog
					(EU-Hosting, über eine eigene Subdomain). Dabei können Seitenaufrufe, Klicks, grobe Gerätedaten, die
					Sprache und – wenn du eingeloggt bist – eine interne Nutzer-ID sowie E-Mail und Anzeigename verarbeitet
					werden. Wir nutzen das für Produktverbesserung, Fehlerbehebung und Missbrauchserkennung, nicht für
					personalisierte Werbung Dritter. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Du kannst der Analyse mit
					Wirkung für die Zukunft widersprechen, indem du uns schreibst oder Analyse-Cookies in deinem Browser
					blockierst.
				</p>

				<h3>10. Cookies und ähnliche Technologien (§ 25 TDDDG)</h3>
				<p>
					Technisch notwendige Speicherung (kein Einwilligungserfordernis), damit der Dienst funktioniert:
				</p>
				<ul>
					<li>Sitzungs-Cookies für Login und Sicherheit (über unseren Auth-Anbieter),</li>
					<li>Sprache (locale),</li>
					<li>Filter-Einstellungen (z. B. Ort und Umkreis),</li>
					<li>kurzlebige Hinweis-Cookies (z. B. nach dem Speichern eines Events).</li>
				</ul>
				<p>
					Analyse-Speicherung von PostHog ist nicht streng erforderlich. Du kannst sie über Browsereinstellungen
					unterbinden oder uns um Widerspruch bitten.
				</p>

				<h3>11. Empfänger und Auftragsverarbeitung</h3>
				<p>Wir geben Daten nur weiter, wenn das für Blissbase nötig ist oder wir gesetzlich müssen:</p>
				<ul>
					<li>Google Ireland Limited / Google LLC: Google-Anmeldung und Karten-/Ortssuche.</li>
					<li>Supabase (Auth und Datenbank): Speicherung von Konten, Profilen, Events und Angeboten.</li>
					<li>Vercel: Hosting und Auslieferung der Website, grobe IP-Geolokation.</li>
					<li>Cloudflare R2: Speicherung hochgeladener Bilder.</li>
					<li>PostHog: Produktanalyse, gehostet in der EU.</li>
					<li>Resend: Versand transaktionaler E-Mails (z. B. Bestätigung nach Event-Erstellung). Login-Codes
						versendet unser Auth-Anbieter.</li>
				</ul>
				<p>
					Soweit diese Anbieter außerhalb der EU/EWR Daten verarbeiten, geschieht das auf Grundlage geeigneter
					Garantien (insbesondere EU-Standardvertragsklauseln) bzw. weil du den Dienst aktiv nutzt (z. B.
					Google-Anmeldung oder Ortssuche).
				</p>

				<h3>12. Speicherdauer</h3>
				<p>
					Kontodaten speichern wir, solange dein Konto besteht. Öffentliche Inhalte bleiben veröffentlicht, bis du
					sie löschst oder uns um Löschung bittest. Logs und Sicherungen behalten wir nur so lange, wie es für
					Sicherheit, Fehlerbehebung und gesetzliche Pflichten nötig ist. Öffentlich übernommene Eventdaten
					bleiben, solange das Event für den Kalender relevant ist.
				</p>

				<h3>13. Rechtsgrundlagen</h3>
				<ul>
					<li>Art. 6 Abs. 1 lit. b DSGVO: Konto, Login, Favoriten, Veröffentlichen von Events und Angeboten.</li>
					<li>
						Art. 6 Abs. 1 lit. f DSGVO: Sicherheit, Missbrauchsschutz, Aggregation öffentlich zugänglicher
						Eventdaten, grobe IP-Lage, Reichweiten- und Fehleranalyse.
					</li>
					<li>Art. 6 Abs. 1 lit. a DSGVO und § 25 TDDDG: optionale Geräte-Standortfreigabe.</li>
					<li>Art. 6 Abs. 1 lit. c DSGVO: gesetzliche Auskunfts- oder Aufbewahrungspflichten.</li>
				</ul>

				<h3>14. Deine Rechte</h3>
				<p>
					Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und
					Widerspruch gegen Verarbeitungen auf Basis berechtigter Interessen. Du kannst eine Einwilligung
					jederzeit mit Wirkung für die Zukunft widerrufen. Es findet keine automatisierte Entscheidung im Sinne
					von Art. 22 DSGVO statt.
				</p>
				<p>
					Außerdem hast du das Recht, dich bei einer Datenschutzaufsichtsbehörde zu beschweren, insbesondere bei
					der Behörde deines Wohnsitzes oder am Sitz des Verantwortlichen in Deutschland (eine Übersicht führt der
					<a
						href="https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html"
						class="link"
						target="_blank"
						rel="noopener noreferrer">BfDI</a
					>).
				</p>
				<p>Dafür reicht eine E-Mail an <a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.</p>

				<h3>15. Konto- und Datenlöschung</h3>
				<p>
					Du kannst dein Konto und die damit verbundenen personenbezogenen Daten löschen lassen, indem du uns an
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>
					schreibst. Wir löschen dann Profil, Favoriten und nicht mehr benötigte Kontodaten. Bereits öffentlich
					geteilte Event- oder Angebotstexte können wir anonymisieren oder entfernen; Inhalte, die wir aus
					öffentlichen Drittquellen übernommen haben, sind davon unabhängig.
				</p>

				<h3>16. Sicherheit und Kinder</h3>
				<p>
					Wir treffen angemessene technische und organisatorische Maßnahmen (verschlüsselte Übertragung, Zugriff
					nur soweit nötig). Blissbase richtet sich nicht an Kinder unter 16 Jahren. Wir erheben wissentlich keine
					Daten von Kindern. Wenn du glaubst, dass ein Kind uns Daten übermittelt hat, schreib uns, damit wir sie
					löschen.
				</p>

				<h3>17. Änderungen</h3>
				<p>
					Wenn sich Blissbase oder die Rechtslage ändert, passen wir diese Erklärung an. Die aktuelle Fassung
					findest du immer unter
					<a href={routes.privacyPolicy()} class="link">{privacyPolicyUrl}</a>. Wesentliche
					Änderungen der Nutzung von Google-Nutzerdaten nehmen wir erst vor, nachdem wir dich informiert und — wo
					nötig — erneut um Einwilligung gebeten haben.
				</p>

				<h3>18. Kontakt</h3>
				<p>
					Fragen zum Datenschutz, Auskunfts- und Löschanfragen:
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. Die Nutzungsbedingungen findest du
					unter
					<a href={routes.termsOfService()} class="link">Nutzungsbedingungen</a>.
				</p>
			</section>

			<div class="divider"></div>

			<section id="en">
				<h2>Privacy Policy (English)</h2>
				<p>This English text is a translation of the German policy. If they differ, the German version prevails.</p>

				<h3>1. Controller</h3>
				<p>
					The controller for personal data on
					<a href={BASE_URL} class="link">blissbase.app</a>
					(“Blissbase”, “we”) under the GDPR is Samuel Bach, Germany,
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. A postal address is available on
					request at that email. No data protection officer is appointed because none is legally required.
				</p>

				<h3>2. What Blissbase is</h3>
				<p>
					Blissbase is a free web app to find, save, and publish mindful events, retreats, workshops, community
					gatherings, and offerings. Browsing does not require an account. An account is required for favorites, a
					public profile, or publishing your own events and offerings.
				</p>

				<h3>3. Data we process</h3>
				<p>
					Account data (email, display name, optional profile photo, bio, location, social links); content you
					create (events, offerings, images, favorites); usage data (pages viewed, approximate access-provider
					location, device, language); technical data (IP address, browser, timestamps, cookies).
				</p>

				<h3>4. Google Sign-In</h3>
				<p>
					See the dedicated “Google user data” section at the top. That section is the disclosure of how we
					access, use, store, and share Google user data, including Limited Use.
				</p>

				<h3>5. Email sign-in</h3>
				<p>
					You may sign in with email and a one-time code or magic link. We store the email and send login mail
					only for authentication (GDPR Art. 6(1)(b)).
				</p>

				<h3>6. Profiles, events, and offerings</h3>
				<p>
					Public profiles, events, and offerings you publish are visible to other Blissbase users. Favorites stay
					private. Some events are copied from public calendars, websites, and community channels (title, time,
					place, description, images, source). Third-party personal data in those listings is processed under GDPR
					Art. 6(1)(f) and Art. 14. You may ask us to delete or anonymize it.
				</p>

				<h3>7. Location and Google Maps / Places</h3>
				<p>
					Location search and place entry use Google Maps and Places. Your query or coordinates are sent to Google
					so we can show suggestions and distances. This does not require Google Sign-In. Optional browser
					geolocation is used only to suggest nearby events and is not stored as a movement profile (consent via
					the browser prompt; GDPR Art. 6(1)(a) and TDDDG § 25).
				</p>

				<h3>8. Approximate location from your connection</h3>
				<p>
					Our host may derive country, region, city, and rough coordinates from the IP address. If you have not
					chosen a place yet, we may use that to suggest nearby events. It is not GPS and not a movement profile
					(GDPR Art. 6(1)(f)).
				</p>

				<h3>9. Analytics (PostHog)</h3>
				<p>
					We use PostHog (EU-hosted, via our own subdomain) for product improvement, debugging, and abuse
					prevention: page views, clicks, coarse device data, language, and — if you are signed in — an internal
					user id plus email and display name. Not for third-party personalized ads (GDPR Art. 6(1)(f)). You may
					object by emailing us or blocking analytics cookies.
				</p>

				<h3>10. Cookies (TDDDG § 25)</h3>
				<p>
					Strictly necessary storage: login/session, language, filter preferences, short-lived flash notices.
					PostHog analytics storage is not strictly necessary; you can block it in the browser or object by email.
				</p>

				<h3>11. Recipients</h3>
				<p>
					Google (sign-in and maps/places); Supabase (auth and database); Vercel (hosting and coarse IP
					geolocation); Cloudflare R2 (uploaded images); PostHog (product analytics, EU); Resend (transactional
					email such as event-created notices; login codes are sent by our auth provider). We share data only as
					needed to run Blissbase or as required by law. Transfers outside the EU/EEA use appropriate safeguards,
					in particular Standard Contractual Clauses.
				</p>

				<h3>12. Retention</h3>
				<p>
					Account data lasts for the life of the account. Public content stays until you delete it or ask us to.
					Logs and backups are kept only as needed for security, debugging, and legal duties. Scraped event data
					stays while it remains relevant to the calendar.
				</p>

				<h3>13. Legal bases</h3>
				<p>
					Art. 6(1)(b) contract (account, login, favorites, publishing); Art. 6(1)(f) legitimate interests
					(security, public event aggregation, coarse IP location, analytics); Art. 6(1)(a) and TDDDG § 25
					(optional device location); Art. 6(1)(c) legal obligation.
				</p>

				<h3>14. Your rights</h3>
				<p>
					Access, rectification, erasure, restriction, portability, and objection to legitimate-interest
					processing; withdrawal of consent for the future. No automated decision-making under Art. 22 GDPR. You
					may lodge a complaint with a supervisory authority, including the authority at your place of residence
					or at the controller’s seat in Germany (directory:
					<a
						href="https://www.bfdi.bund.de/EN/Service/Anschriften/Laender/Laender-node.html"
						class="link"
						target="_blank"
						rel="noopener noreferrer">BfDI</a
					>). Email
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>.
				</p>

				<h3>15. Account deletion</h3>
				<p>
					Email
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>
					to delete your account and related personal data. We then delete profile, favorites, and unused account
					data. Public event or offering text may be anonymized or removed. Independently scraped third-party
					listings are separate.
				</p>

				<h3>16. Security and children</h3>
				<p>
					We use appropriate technical and organizational measures, including encryption in transit. Blissbase is
					not directed at children under 16. If you believe a child has provided data, contact us so we can delete
					it.
				</p>

				<h3>17. Changes</h3>
				<p>
					The current version is always at
					<a href={routes.privacyPolicy()} class="link">{privacyPolicyUrl}</a>. If we change how we
					use Google user data, we will notify you and, where required, ask for consent before the new use.
				</p>

				<h3>18. Contact</h3>
				<p>
					Privacy questions:
					<a href="mailto:hi@blissbase.app" class="link">hi@blissbase.app</a>. Terms:
					<a href={routes.termsOfService()} class="link">Terms of Service</a>.
				</p>
			</section>
		</article>
	</div>
</div>
