import { expect } from 'vitest';
import { broadestTagSlugs, eventStructureSlugs } from '$lib/eventCategories';
import type { AiExtractEventDataArgs, MsgAnalysisAnswer } from '$lib/server/ai';

const broadestTags = new Set<string>(broadestTagSlugs);
const structureSlugs = new Set<string>(eventStructureSlugs);

export const nonEventMessages = [
	{
		name: `chatter that does not announce an event`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `Hey, does anyone know a good café near Schönhauser Allee? Looking for a quiet place to work.`,
	},
	{
		name: `a conscious gathering that has no start date`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `Ecstatic Dance Berlin is happening again soon in our studio. Barefoot, conscious dance. I will share the date in a later message.`,
	},
	{
		name: `a dated event that is not conscious`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `Functional Strength Class
Thursday, 1 October 2026, 18:00–19:00
Iron Gym, Hauptstraße 5, Berlin
A regular gym workout. Barbell strength training only. Drop-in 15€.
https://irongym.example/book`,
	},
] satisfies EventMessage[];

export const eventMessages = [
	{
		name: `Ecstatic Dance (contact the author)`,
		messageDate: new Date(`2026-09-01T12:00:00.000Z`),
		message: `Ecstatic Dance Berlin
Friday, 2 October 2026, 19:00–22:00
Studio Licht, Schönhauser Allee 10, Berlin
Barefoot conscious dance. No website and no email.
Schreib mir bitte hier im Chat, wenn du kommen möchtest. Ich schicke dir die Details.`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: true, language: `german`, tags: [`dance`] },
		fields: {
			name: [`Ecstatic Dance`],
			startDate: `2026-10-02T17:00:00.000Z`,
			endDate: `2026-10-02T20:00:00.000Z`,
			url: null,
			venue: /Studio Licht/,
			city: `Berlin`,
		},
	},
	{
		name: `Embodied Consent Lab`,
		messageDate: new Date(`2026-04-29T06:00:00.000Z`),
		message: `*Einladung zum 𝐄𝐦𝐛𝐨𝐝𝐢𝐞𝐝 Consent Lab in Berlin*

Embodied Consent Lab

Join us for a WhatsApp-only event called "Embodied Consent Lab" at The Practice Room.
The facilitator says: "Bring a blanket, water, and curiosity." 🌿
Keep this html break exactly: first line<br>second line

Date: May 21, 2026
Time: 19:00 - 21:00
Location: The Practice Room, Schönhauser Allee 10, Berlin
Attendance: offline+online (hybrid). Both in-person attendance and online attendance are possible.
Price: This sliding scale is intentionally too long to extract cleanly because it includes many details, exceptions, donation notes, discounts, support options, and follow-up arrangements that exceed one hundred characters.
Event page: https://example.com/embodied-consent
Do not use this map as the event URL: https://maps.google.com/?q=The+Practice+Room
Do not use this Telegram link as the event URL: https://t.me/example_channel
This event will be held in portuguese.
Register: hello@example.com
WhatsApp questions: +49123456789
Message me only if both registration links fail.`,
		judgment: { attendanceMode: `offline+online`, contactAuthorForMore: false, language: `portuguese`, tags: [`intimacy`, `relationship`] },
		fields: {
			name: [`Embodied Consent Lab`],
			description: [`"Bring a blanket, water, and curiosity."`, `🌿`, `first line<br>second line`],
			startDate: `2026-05-21T17:00:00.000Z`,
			endDate: `2026-05-21T19:00:00.000Z`,
			url: `https://example.com/embodied-consent`,
			contact: [`mailto:hello@example.com`, `49123456789`],
			price: null,
			venue: `The Practice Room`,
			address: [`Schönhauser Allee 10`, `Berlin`],
			city: `Berlin`,
		},
	},
	{
		name: `Sound & Release`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `✨ Sound & Release – eine Inner Alignment Session ✨

Ein Raum, um wieder bei dir anzukommen.

Du legst dich hin, lässt dich von Musik und Frequenzen tragen und gibst deinem Körper Raum, Spannung loszulassen und dich neu auszurichten.

Durch Co-Regulation, Musik und sanfte Berührungen begleiten dich unsere ausgebildeten Facilitator achtsam durch deinen individuellen Prozess.

Es geht nicht darum, etwas leisten oder erreichen zu müssen.
Sondern darum, wahrzunehmen, was gerade da ist – und wieder mehr in Verbindung mit dir selbst zu kommen.

💛 Wir möchten diese Erfahrung für möglichst viele Menschen zugänglich machen. Deshalb ist dein erster Besuch auf Spendenbasis. Du entscheidest selbst, was du geben möchtest – anonym vor Ort.

Sound & Release ist eine Einladung zu mehr innerer Ausrichtung, Präsenz und Verbindung.

🌿 Sonntag, 27. September
🕙 10:00–12:30 Uhr
📍 Rote Fabrik, München
💛 Erstbesuch: auf Spendenbasis, danach 20€
Infos & Anmeldung:
https://tg.soundrelease.space

✨ Wir freuen uns, auf dich.`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: false, language: `german`, tags: [`sound-healing`, `meditation`] },
		fields: {
			name: [`Sound & Release`, `Inner Alignment Session`],
			description: [`Co-Regulation`, `💛`],
			startDate: `2026-09-27T08:00:00.000Z`,
			endDate: `2026-09-27T10:30:00.000Z`,
			url: `https://tg.soundrelease.space`,
			venue: `Rote Fabrik`,
			address: [`Rote Fabrik`, `München`],
			city: `München`,
		},
	},
	{
		name: `Tantrischer Reigen`,
		messageDate: new Date(`2026-09-20T08:00:00.000Z`),
		message: `"Lust auf deine Selbst-Entfaltung?"

Tantrischer Reigen 
Im Neuen Garten 

Möchtest du dir deine Lebenszeit widmen? 

Deine Begegnung mit dir selbst pflegen und feiern? 

Dich aus dir selbst in deine Lebendigkeit heraus entwickeln? 

Du musst dich nicht ständig neu erfinden. 
Ein kleiner Schritt zurück gibt dir den Raum und die Not-wenige Luft zum Durchatmen. 
Nimm dich selbst raus aus deinem Alltag und übe, dich und deine Bedürfnisse für Kontaktaufnahme wahrzunehmen und achtsam damit umzugehen. 

Bewusst. Kraftvoll. Sinnvoll. 

In unseren Räumen wird deine Selbstachtung gefördert und den inneren Raum bekommen, den sie braucht. 

Sei dabei und finde mit uns den Weg zurück zu deiner Natur. 

Willkommen 
Im Neuen Garten 🌱
Lebens- und Liebesschule in München 

Wann:
Freitag, 25.09.26 um 19.30 Uhr bis Sonntag 27.09.26 um 18.00 Uhr 

Wo:
Im Tempel 
Im Neuen Garten 
Münchener Straße 9
85540 Haar 

Förderbeitrag:
ab 430€ inkl. Verpflegung 

Kontakt:
Info@im-neuen-garten.de

Info & Anmeldung:
https://im-neuen-garten.de/der-tantrische-reigen/`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: false, language: `german`, tags: [`intimacy`] },
		fields: {
			name: [`Tantrischer Reigen`],
			description: [`Selbstachtung`],
			startDate: `2026-09-25T17:30:00.000Z`,
			endDate: `2026-09-27T16:00:00.000Z`,
			url: `https://im-neuen-garten.de/der-tantrische-reigen/`,
			contact: [`mailto:info@im-neuen-garten.de`],
			price: /430\s*€/,
			venue: /Tempel|Neuen Garten/,
			address: [`Münchener Straße 9`, `Haar`],
			city: `Haar`,
		},
	},
	{
		name: `Montagssingkreis`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `Ihr lieben ~  Die Anmeldung ist eröffnet für unseren nächsten Montagssingkreis 🌷😊🎶☀️

🎊Ich freu mich mit euch neue Lieder zu singen mit meinem neuen Zusatz-Liederzettel 🎊

Melde dich bitte an (oder schreibe mir eine Nachricht @rafaelsoleil) und falls du Lied wünsche hast so teile sie mir gerne mit. 
Deine Anmeldung: https://lets-meet.org/reg/76ba0cd95133f88e9b

💐🌷🦋🌿🪴🌺🌸🌼
☀️ Montag 28.09.'26
☀️🎶☀️Ankommen ab 19:00 Uhr
☀️🎶☀️🎶Beginn: 19:30 Uhr
☀️🎶☀️🎶☀️Ort: Meditationsraum Holweide, Bergisch Gladbacher Str. 408, 51067 Köln.

Wir singen eine bunte Mischung aus Mantra's, Spirituelle Lieder aus aller Welt, Rainbowsongs.

🎶Link zu meiner Telegrammgruppe: https://t.me/Singyourheartanddance 🌈
Ich freue mich riesig!

Zahlt gerne was ihr möchtet zwischen 10 und 50 Euro.

Rafael Soleil ☀️🎶☀️💜🦋☀️
Kontakt & Mehr:
www.rafael-soleil.de
https://www.instagram.com/rafaelsoleil`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: false, language: `german`, tags: [`voice`, `music`] },
		fields: {
			name: [`Montagssingkreis`],
			description: [`Mantra`],
			startDate: `2026-09-28T17:30:00.000Z`,
			endDate: null,
			url: `https://lets-meet.org/reg/76ba0cd95133f88e9b`,
			price: /10.*50.*€/,
			venue: `Meditationsraum Holweide`,
			address: [`Bergisch Gladbacher Str`, `408`, `Köln`],
			city: `Köln`,
		},
	},
	{
		name: `Tee-Kreis`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `💚Offener Tee-Kreis Augsburg 🍵
-Grün-Tee Edition-

📍Wo?  Dompark Augsburg,
(48.3724208, 10.8954723)
📅 Wann?  27.09.2026, 13:00 – 14:30
📝 Anmeldung: https://www.yabukita.de/event-details/offener-tee-kreis-augsburg-gruntee-edition
💰 Wertschätzung 10-20€

📝 Mehr Infos: 
Willkommen zu unserem monatlichen Tee-Treff! Wir laden euch zu dieser ganz besonderen Tee-Zeremonie ein, bei der ihr die Welt des Tees entdecken und die Kunst des Teetrinkens erleben könnt.

Beim nächsten Tee-Kreis widmen wir uns ganz dem grünen Tee. Gemeinsam verkosten wir ausgewählte Grüntees aus Taiwan, Japan und Indien und entdecken, wie unterschiedlich sich Herkunft, Verarbeitung und Teekultur in Duft und Geschmack zeigen.

Wie immer nehmen wir uns Zeit für bewussten Genuss, Austausch und ein wenig Tee-Wissen – Tasse für Tasse.

Spontanes Dazukommen & früher Gehen sind möglich.
 
Kommt vorbei! Schlürft mit!
Ich freue mich auf euch,
Henning`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: false, language: `german`, tags: [`ceremony`, `circle`] },
		fields: {
			name: [`Tee-Kreis`],
			description: [`grünen Tee`],
			startDate: `2026-09-27T11:00:00.000Z`,
			endDate: `2026-09-27T12:30:00.000Z`,
			url: `https://www.yabukita.de/event-details/offener-tee-kreis-augsburg-gruntee-edition`,
			price: /10.*20.*€/,
			venue: /Dompark/,
			address: [`Dompark`, `Augsburg`],
			city: `Augsburg`,
		},
	},
	{
		name: `inneres Kind workshop`,
		messageDate: new Date(`2026-09-26T08:00:00.000Z`),
		message: `Workshop 18.10.2026 in Esslingen 
✨ Dem inneren Kind begegnen
– Bindungsmuster erkennen & Glaubenssätze transformieren ✨

Vielleicht kennst du das: eine kleine Unstimmigkeit und plötzlich fühlst du dich tief verletzt, überfordert und überwältigt. 
Du nimmst dir vor, beim nächsten Mal anders zu reagieren, aber die Situation entgleitet dir schneller, als du denken kannst.
In solchen Situationen übernimmt häufig dein inneres Kind die Führung.

🌀 Es ist Zeit für eine neue Erfahrung mit alten Mustern! 🌀

Dich erwarten:
🌱 eine kleine Gruppe
🌱 ein geschützter und liebevoll gehaltener Raum
🌱 gestalttherapeutische Begleitung
🌱 körper- & erlebnisorientierte Übungen
🌱 erforschen von verletzlichen & kraftvollen Anteilen

🗓️ Wann:
18.10.2026 10.00 - 19.30 Uhr 

🏠 Wo:
Im Menschen:raum Esslingen
(5 Minuten Fußweg vom Bahnhof)

💰 Deine Investition:
Frühbucherpreis: 135€ (gültig bis 20.09.26)
Anschließend: 155€

💌 Weitere Infos und Anmeldung:
https://www.verwurzelt-im-sein.de/workshop-inneres-kind/

Solltest du noch Fragen haben, meld dich gerne!

Wir freuen uns auf dich 🥰🥰
Tatjana & Tobias`,
		judgment: { attendanceMode: `offline`, contactAuthorForMore: false, language: `german`, tags: [`inner-work`] },
		fields: {
			name: [`inneren Kind`],
			description: [`inneres Kind`],
			startDate: `2026-10-18T08:00:00.000Z`,
			endDate: `2026-10-18T17:30:00.000Z`,
			url: `https://www.verwurzelt-im-sein.de/workshop-inneres-kind/`,
			price: /(?=.*135)(?=.*155)/,
			venue: /Menschen:?raum/,
			city: `Esslingen`,
		},
	},
] satisfies EventMessageWithExpectations[];

/** Analysis args with a unique suffix so the provider prompt cache cannot reuse a previous answer. */
export function uncachedArgs({ message, messageDate }: EventMessage) {
	return {
		message: `${message}\n${crypto.randomUUID()}`,
		messageDate,
		timezone: `Europe/Berlin`,
		eventIsDefinitelyConscious: false,
	} satisfies AiExtractEventDataArgs;
}

export function expectEventFields(result: MsgAnalysisAnswer, fields: ExpectedFields) {
	expect(result.hasEventData).toBe(true);
	expect(result.isConscious).toBe(true);
	expect(result.existingSource).toBeUndefined();

	for (const part of fields.name) expect(result.name).toContain(part);
	expect(result.description?.startsWith(result.name ?? ``)).toBe(false);
	for (const part of fields.description ?? []) expect(result.description).toContain(part);

	expect(result.startDate).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
	expect(new Date(result.startDate!).toISOString()).toBe(fields.startDate);
	if (fields.endDate === null) expect(result.endDate).toBeUndefined();
	if (fields.endDate) expect(new Date(result.endDate!).toISOString()).toBe(fields.endDate);

	if (fields.url === null) expect(result.url).toBeUndefined();
	if (fields.url) expect(result.url).toBe(fields.url);
	expect(result.url ?? ``).not.toMatch(/maps\.google\.com|t\.me|instagram\.com/);

	const contacts = result.contact?.map((contact) => contact.toLowerCase()) ?? [];
	expect(contacts.every((contact) => /^[a-z][a-z0-9+.-]*:/.test(contact))).toBe(true);
	expect(contacts.some((contact) => /maps\.google\.com|t\.me/.test(contact))).toBe(false);
	for (const part of fields.contact ?? []) expect(contacts.some((contact) => contact.includes(part))).toBe(true);

	if (fields.price === null) expect(result.price).toBeUndefined();
	if (fields.price) expect(result.price).toMatch(fields.price);
	if (result.price != null) {
		expect(result.price.length).toBeLessThanOrEqual(100);
		expect(result.price).not.toMatch(/\n|<br>/);
	}

	if (typeof fields.venue === `string`) expect(result.venue).toBe(fields.venue);
	else expect(result.venue).toMatch(fields.venue);
	for (const part of fields.address ?? []) expect(result.address).toContain(part);
	expect(result.city).toBe(fields.city);
}

/** Closed judgments Jev answers in the messenger pipeline. */
export function expectJudgment(result: MsgAnalysisAnswer, judgment: ExpectedJudgment) {
	expect(result.attendanceMode, `attendanceMode`).toBe(judgment.attendanceMode);
	expect(result.contactAuthorForMore, `contactAuthorForMore`).toBe(judgment.contactAuthorForMore);
	expect(result.language, `language`).toBe(judgment.language);
	expectCatalogTags(result.tags);
	const tagsLabel = `tags: expected one of ${judgment.tags.join(`, `)}, got ${result.tags?.join(`, `) || `none`}`;
	expect(judgment.tags.some((tag) => result.tags?.includes(tag)), tagsLabel).toBe(true);
	if (result.structure) expect(structureSlugs.has(result.structure)).toBe(true);
}

export function expectCatalogTags(tags: string[] | undefined) {
	const label = `tags ${tags?.join(`, `) || `none`}`;
	expect(tags?.length, label).toBeGreaterThan(0);
	expect(tags?.length, label).toBeLessThanOrEqual(4);
	expect(tags?.every((tag) => broadestTags.has(tag)), label).toBe(true);
	expect(tags?.some((tag) => structureSlugs.has(tag)), label).toBe(false);
}

type EventMessage = { name: string; message: string; messageDate: Date };

type ExpectedJudgment = Pick<MsgAnalysisAnswer, `attendanceMode` | `language`> & {
	contactAuthorForMore: boolean;
	/** At least one of these has to be among the result tags. */
	tags: string[];
};

/** `null` means the field has to be empty, a missing key means it is not checked. */
type ExpectedFields = {
	name: string[];
	description?: string[];
	startDate: string;
	endDate?: string | null;
	url?: string | null;
	contact?: string[];
	price?: RegExp | null;
	venue: string | RegExp;
	address?: string[];
	city: string;
};

type EventMessageWithExpectations = EventMessage & { judgment: ExpectedJudgment; fields: ExpectedFields };
