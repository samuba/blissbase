import { readFile } from "node:fs/promises";
import type { AiImageInput } from "$lib/server/ai";

export const imageTranscriptCases = [
	{
		name: `leadership lab`,
		files: [`leadership-lab.webp`],
		lines: lines(`
			Leadership
			LAB
			Thema:
			Auf Kurs bleiben -
			deine Ausrichtung
			verkörpern und leben
			mit Leadership³
			21.01.2026
			18:00- ca. 21:00
			coding. powerful.
			systems.
			Berlin-Prenzlauer Berg
			gegen Spende
		`),
	},
	{
		name: `embodied evening`,
		files: [`embodied.webp`],
		lines: lines(`
			EIN ABEND FÜR DICH.
			Embodied.
			Raus aus dem Kopf.
			Zurück in deinen Körper.
			Wenn Verstehen allein nicht mehr reicht.
			Du weißt genug.
			Jetzt ist Zeit, es zu fühlen.
			Nicht im Kopf. Im Körper.
			Was dich erwartet:
			Ein Abend mit somatischer Bewegung, bewusstem Atem,
			Entspannungsübungen und Kakao. Kein Kurs. Kein
			Programm. Ein Raum, in dem du zur Ruhe kommst,
			deinen Körper wieder spürst und dich selbst ein Stück
			mehr wiederfindest.
			Bewegung
			Atem
			Nervensystem
			Kakao
			Du musst nichts leisten.
			Nichts darstellen.
			Du darfst einfach sein.
			Ruhig.
			Ehrlich.
			In deinem Tempo.
			DATUM
			Freitag, 5. Juni
			ZEIT
			19 Uhr
			WO
			35117 Münchhausen
			ENERGIEAUSGLEICH
			44€
			YOGASTUDIO ATEMWEISE.
		`),
	},
	{
		name: `daughters of the moon`,
		files: [`daughters-of-the-moon.webp`],
		lines: lines(`
			Daughters of the Moon
			REINIGUNGSHÜTTE
			to heal &
			bless the Womb
		`),
	},
	{
		name: `stille und klang`,
		files: [`stille-und-klang.webp`],
		lines: lines(`
			Mit Stille und Klang
			zu meinen Wurzeln
			Systemische Aufstellungen
			in Norddeutschland
			7. März 2026
			Kirche der Stille/
			Hamburg
			10 - 17 Uhr
			Teilnehmer/innen-
			zahl begrenzt
			ReGer
			Familienaufstellungen
			Judith Regitz
			Urs Germann
			Deutschland & Schweiz
		`),
	},
	{
		name: `mutter-tochterkreis`,
		files: [`mutter-tochterkreis.webp`],
		lines: lines(`
			MUTTER-
			TOCHTERKREIS
			mit Kakao & Henna
			für Mädchen ab 4
			Wo? Lighthouse Dresden
			(am Schillerplatz)
			Wann? 25.10., 13:00 – 15:00
		`),
	},
	{
		name: `rasu yawanawa`,
		files: [`rasu-yawanawa.webp`],
		lines: lines(`
			NARAYA
			RASU YAWANAWÁ
			& FAMILY
			INVITATION TO CONNECT, LEARN & CELEBRATE
			NETHERLANDS
			30.07.
			2.08.2026
			nai@naraya.world
		`),
	},
	{
		name: `vulva erfahrungsraum`,
		files: [`vulva-erfahrungsraum.webp`],
		lines: lines(`
			-VULVA-
			ERFAHRUNGSRAUM
			Zweiteiliges Wochenendseminar für
			alle Weiblichkeiten mit Vulva
			SA.21.03. UND SO.22.03.26
			ENTDECKUNGSRAUM VULVA
			benennen, verstehen, spüren
			SA.25.04. UND SO.26.04.26
			RESONANZRAUM VULVA
			sehen, lauschen, fühlen
			Selbsterlebensraum
			in 99084 Erfurt
			Nova
			Melanie
		`),
	},
	{
		name: `weibliche urkraft`,
		files: [`weibliche-urkraft.webp`],
		lines: lines(`
			Weibliche UrKraft Nähren
			18.-19.10.2025 - 11.00-19.00 Uhr
			Seminarort: Lübstorf bei Schwerin
		`),
	},
	{
		name: `heilsames miteinander`,
		files: [`heilsames-miteinander.jpg`],
		lines: lines(`
			16. - 18. OKT.
			2026
			Fr, 17.00 Uhr-
			So, 14.00 Uhr
			HEILSAMES
			MITEINANDER
			Ein Wochenende zum Ankommen in Dir, in achtsamer Gemeinschaft,
			mitten in der Natur. Leicht, lebendig, wahrhaftig, herzverbunden.
			RESONIERT DAS WORT „HEILSAM“
			UND „MITEINANDER“ IN DIR?
			Wie wäre das, wenn beides zusammen kommt?
			Wie würde sich das anfühlen?
			Wir öffnen einen Herzraum an einem magischen Ort mitten in der
			Natur, in dem dieses Heilsame Miteinander erlebbar werden kann
			UND in dem auch Raum für dein Wirken ist, wenn du magst.
			DER ORT
			DIE LUPPBODEMÜHLE
			Ein magischer Kraft-Ort mit
			Bach, Feenwäldchen und mehr.
			Mitten im Harz
			BIST DU DABEI?
			UNSERE SCHÄTZE
			Heilsames Singen
			Embodiment
			Freies Gestalten mit Farben und Tanz
			Systemische Arbeit
			Naturbegegnung
			schamanische Reise
			Prozessbegleitung
			Human Design
			deine Ideen!
			EIN WOCHENENDE.
			VIELE SCHÄTZE.
			EIN WIR, DAS BERÜHRT.
			CO-KREATION
			Wir öffnen einen geschützten Raum für dich,
			in dem auch du deine Schätze (an Methoden,
			Ritualen, Inspirationen) teilen kannst.
			Und egal, ob das Feld für dich neu ist, du
			selbst eintauchen magst oder schon
			Erfahrung in der Heilarbeit, im Coaching oder
			kreativen Ausdruck mitbringst.
			Du bist hier genau richtig, wenn du mit uns
			eine neue Form des Miteinanders erleben
			(und mitgestalten) möchtest.
			RAHMEN
			Max. 12 Herzen- für ein intensives Zusammen-
			Schwingen.
			Mit 100,- € (netto) reservierst du deinen Platz
			und zeigst dein Commitment.
			Seminarleitung: Über deinen freiwilligen
			Wertschätzungs-Beitrag entscheidest du in einer
			Beitragsrunde vor Ort.
			Verpflegung: Gemeinsam aus der Fülle: Bringt
			am besten eure Lieblingszutaten für unsere
			gemeinsamen Mahlzeiten mit (gerne
			vegan/vegetarisch), die wir in Co-Kreation
			zubereiten.
			Unterkunft und Gemeinschaftsräume:
			finanzieren wir ebenfalls über eine
			Beitragsrunde, für die Übernachtung stehen uns
			2 Ferien-Wohnungen und einige Gästezimmer
			(mit 1-3 Betten) zur Verfügung.
			WIR SIND BEATE & MASSIH
			Beate
			Massih
			liebt es herzverbindende
			Räume zu öffnen, die sich
			prozesshaft entfalten und in
			denen eigene Potentiale
			erlebbar werden. Mit
			heilsamem Singen, intuitiver
			Bewegung und Kreativität,
			Waldbaden und Achtsamkeit
			in der Natur lädt sie ein, der
			inneren Führung und der
			Verbundenheit zu folgen.
			glaubt an die Kraft von
			Leichtigkeit, Humor und echter
			Freude. Als Psychologe schafft
			er sichere Häfen, in denen du
			einfach du selbst sein kannst.
			Mit Herz, Klarheit und
			systemischem Blick verbindet
			er fundierte Psychologie mit
			Embodiment, damit du ganz
			entspannt bei dir ankommst.
			www.massihpsychology.org
			KONTAKT & ANMELDUNG
			IN VORFREUDE & VERBUNDENHEIT
			Massih & Beate
			0177/ 5076730
			heil_mit@gmx.de
		`),
	},
	{
		name: `golden light`,
		files: [`golden-light.jpg`],
		lines: lines(`
			GOLDEN LIGHT
			EVENT FÜR MEDITATION, LEBENSFREUDE, SEIN.
			Ankommen. Loslassen. Leuchten.
			AKTIVE
			MEDITATIONEN
			STILLE
			BEWEGUNG
			BEGEGNUNG
			Entdecke den Weg raus aus dem Stress und Strudel des Alltags
			mit aktiven Meditationen mit Musik und Bewegung.
			Speziell konzipiert für den heutigen Menschen von Osho.
			Revolutionär, spiritueller Meister und meist gelesener
			Sach- und Hörbuchautor unserer Zeit.
			SEMINARHAUS KIESELHOF
			71540 MURRHARDT
			Donnerstag, 16.00 Uhr, 01.10. - Sonntag, 04.10.2026, 12.30 Uhr
			ab 260,00 Euro
			Social Ticket
			zzgl. wahlweise Übernachtung
			(1,2,3 oder Mehrbettzimmer, Zelt, Camper)
			The way out is the way in.
			Erhalte Einsichten für ein neuen Weg zu leben.
			Veranstalter: Meditation Center Osho Konstanz und Freunde
		`),
	},
	{
		name: `kirtan mantra`,
		files: [`kirtan-mantra.jpg`],
		lines: lines(`
			25.09.2026
			18:45 – 21:30
			SINGEN
			LAUSCHEN
			SEIN
			GEMEINSAM
			Kirtan
			Mantra
			Mit Afsaneh, Moritz, Anni, Heinz, Tim &
			Darja
			Jenseits von richtig & falsch
			liegt ein Ort,
			Dort treffen wir uns.
			Energieausgleich:
			15 – 35 €
			Wo? Langestrasse 79 a,
			44137 Dortmund
			MANTRAS • MUSIK • VERBINDUNG • GEMEINSCHAFT
		`),
	},
	{
		name: `conscious dating lab`,
		files: [`conscious-dating-lab.jpg`],
		lines: lines(`
			Conscious
			Dating Lab
			Dating, nur ehrlicher.
			Spielerische Begegnungen statt
			Smalltalk und Performance-Druck.
			Wild
			hugs
			Echt.
			Locker.
			Ohne dich
			zu verstellen.
			24.09.
			19:00–20:30 Uhr
			New Wild Space
			am Rudolfplatz, Köln
			Schön
			dass du
			hier bist
			MENSCHEN
			STATT
			MASKEN
			MEHR
			ECHTE
			BEGEGNUNGEN
			BITTE.
			VERBINDUNG
			BEGINNT
			HIER
		`),
	},
	{
		name: `inneres kind across both flyer pages`,
		files: [`inneres-kind-front.jpg`, `inneres-kind-back.jpg`],
		lines: lines(`
			Selbsterfahrungsworkshop
			Dem inneren Kind begegnen
			- Bindungsmuster erkennen
			& Glaubenssätze
			transformieren -
			Am 18.10.2026
			10.00 - 19.30 Uhr
			im Menschen:raum
			Esslingen
			Es ist Zeit für eine
			neue Erfahrung
			mit alten
			Bindungsmustern
			& Glaubenssätzen!
			Was wir als Kind nicht fühlen durften, wirkt in uns weiter,
			bis wir uns ihm im Hier und Jetzt zuwenden.
			Vielleicht kennst du das: eine kleine Unstimmigkeit
			und plötzlich fühlst du dich tief verletzt,
			überfordert und überwältigt. In solchen Situationen
			übernimmt häufig dein inneres Kind die Führung.
			In diesem Workshop geht es darum,
			alte Muster zu erkennen und eine neue,
			transformierende Erfahrungen
			im Hier & Jetzt zu machen.
			Dich erwarten:
			eine kleine Gruppe
			ein geschützter Raum
			gestalttherapeutische
			Begleitung
			körper- &
			erlebnisorientierte
			Übungen
			erforschen von
			verletzlichen &
			kraftvollen Anteilen
			Tatjana Hartel
			Wir freuen uns auf dich!
			Tobias Bauer
			Deine Investition: 155€
			Frühbucherpreis: 135€
			(gültig bis 20.09.2026)
			Im Menschen:raum
			Eugenie-von-Sodenstraße 16a
			73728 Esslingen
			Weitere Infos & Anmeldung:
			www.verwurzelt-im-sein.de
			E-Mail: info@verwurzelt-im-sein.de
			Telefon: 0176-16623770
			VERWURZELT IM SEIN
		`),
	},
] satisfies readonly TranscriptCase[];

export async function readFixtureImages(fileNames: readonly string[]) {
	return Promise.all(fileNames.map(async (fileName) => ({
		image: await readFile(new URL(fileName, import.meta.url)),
		mediaType: mediaTypeFor(fileName),
	}) satisfies AiImageInput));
}

function mediaTypeFor(fileName: string) {
	if (fileName.endsWith(`.webp`)) return `image/webp`;
	if (fileName.endsWith(`.jpg`) || fileName.endsWith(`.jpeg`)) return `image/jpeg`;
	throw new Error(`Unsupported fixture image: ${fileName}`);
}

function lines(text: string) {
	return text
		.split(`\n`)
		.map((line) => line.trim())
		.filter((line) => line.length);
}

type TranscriptCase = {
	name: string;
	files: readonly string[];
	lines: readonly string[];
};
