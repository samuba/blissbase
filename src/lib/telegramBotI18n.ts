// Telegram bot messages translations
// Language is detected from ctx.from.language_code
// Defaults to English, only German ('de') gets special treatment

export type BotLanguage = "en" | "de";

export function detectLanguage(languageCode: string | undefined): BotLanguage {
	if (languageCode?.includes("de")) return "de";
	return "en";
}

export const t = {
	start: (lang: BotLanguage) => {
		const de = `Willkommen bei Blissbase.app! 👋 \nUm deinen Event hinzuzufügen, sende einfach die ganze Event Beschreibung, einschließlich Bilder, in EINER Nachricht und ich erledige den Rest. ☺️✨`;
		const en = `Welcome to Blissbase.app! 👋 \nTo add your event, just send me the whole event description, including images, in ONE message and I'll take care of it. ☺️✨`;
		return lang === "de" ? de : en;
	},
	eventExistsOnSource: (lang: BotLanguage, source: string) => {
		const de = `👯 Es sieht aus als ob dieser Event bereits auf ${source} existiert.\nWir fügen regelmäßig alle Events von ${source} zu Blissbase hinzu. Du musst uns diese Events also nicht schicken. 😉`;
		const en = `👯 It looks like this event already exists on ${source}.\nWe regularly add all events from ${source} to Blissbase, so you don't need to send them to us. 😉`;
		return lang === "de" ? de : en;
	},
	extractingEventData: (lang: BotLanguage) => {
		const de = `⏳ Ich extrahiere die Eventdaten aus deiner Nachricht...`;
		const en = `⏳ I am extracting the event data from your message...`;
		return lang === "de" ? de : en;
	},
	noEventData: (lang: BotLanguage) => {
		const de = `🙅🏻‍♂️🎫 Aus dieser Nachricht konnte ich keine Eventdaten extrahieren. Bitte schicke mir eine Event Beschreibung/Ankündigung in einer Nachricht (einschließlich Bilder).`;
		const en = `🙅🏻‍♂️🎫 I couldn't extract any event data from this message. Please send me an event description or announcement in one message (including images).`;
		return lang === "de" ? de : en;
	},
	noEventName: (lang: BotLanguage) => {
		const de = `🙅🏻‍♂️🪧 Aus dieser Nachricht konnte ich keinen eindeutigen Titel für den Event extrahieren.`;
		const en = `🙅🏻‍♂️🪧 I couldn't extract a clear title for the event from this message.`;
		return lang === "de" ? de : en;
	},
	noStartDate: (lang: BotLanguage) => {
		const de = `🙅🏻‍♂️📅 Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren.`;
		const en = `🙅🏻‍♂️📅 I couldn't extract a start time for the event from this message.`;
		return lang === "de" ? de : en;
	},
	noLocation: (lang: BotLanguage) => {
		const de = `🙅🏻‍♂️📍 Aus dieser Nachricht konnte ich keinen Ort für den Event extrahieren. Bitte gebe immer einen Ort an.`;
		const en = `🙅🏻‍♂️📍 I couldn't extract a location for the event from this message. Please always provide a location.`;
		return lang === "de" ? de : en;
	},
	noTelegramUsername: (lang: BotLanguage) => {
		const de = `⚠️ In deiner Nachricht forderst du Teilnehmer auf sich bei dir per Telegram zu melden, allerdings hast du in deinem Profil keinen Telegram Username eingetragen.\n\nBitte lege erst einen Telegram Username fest damit dich Teilnehmer per Telegram Link erreichen können. Danach kannst du mir die Nachricht erneut senden.`;
		const en = `⚠️ In your message you ask participants to contact you via Telegram, but you haven't set a Telegram Username in your profile.\n\nPlease set a Telegram Username first so participants can reach you via Telegram link. Then you can send me the message again.`;
		return lang === "de" ? de : en;
	},
	notEventOwner: (lang: BotLanguage) => {
		const de = `🙅🏻‍♂️🔐 Dieser Event existiert schon und du hast ihn nicht erstellt. Deshalb kannst du ihn auch nicht bearbeiten.`;
		const en = `🙅🏻‍♂️🔐 This event already exists and you didn't create it. Therefore, you cannot edit it.`;
		return lang === "de" ? de : en;
	},
	saveError: (lang: BotLanguage) => {
		const de = `⚠️ Fehler beim Speichern des Events. Bitte versuche es später erneut.`;
		const en = `⚠️ Error saving the event. Please try again later.`;
		return lang === "de" ? de : en;
	},
	genericError: (lang: BotLanguage, error: string) => {
		const de = `⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: ${error}`;
		const en = `⚠️ The message could not be processed. Please try again later.\n\nError: ${error}`;
		return lang === "de" ? de : en;
	},
	eventUpdated: (lang: BotLanguage, url: string, skippedImageMsg: string, adminLinkText: string) => {
		const de = `✅ Der Event wurde aktualisiert:\n<a href="${url}">Link zu deinem Event</a>\n${skippedImageMsg}\n\n${adminLinkText}`;
		const en = `✅ The event has been updated:\n<a href="${url}">Link to your event</a>\n${skippedImageMsg}\n\n${adminLinkText}`;
		return lang === "de" ? de : en;
	},
	eventCreated: (lang: BotLanguage, url: string, adminLinkText: string) => {
		const de = `✅ Der Event wurde in Blissbase eingetragen. Teile den Link mit deinen Teilnehmern:\n<a href="${url}">Link zu deinem Event</a>\n\n${adminLinkText}.`;
		const en = `✅ The event has been added to Blissbase. Share the link with your participants:\n<a href="${url}">Link to your event</a>\n\n${adminLinkText}`;
		return lang === "de" ? de : en;
	},
	adminLinkWarning: (lang: BotLanguage, url: string) => {
		const de = `⚠️ Link zum bearbeiten des Events:\n<a href="${url}">Admin Link (nicht teilen)</a>\nACHTUNG: Jeder mit dem Admin Link kann den Event bearbeiten oder löschen!!`;
		const en = `⚠️ Link to edit the event:\n<a href="${url}">Admin Link (do not share)</a>\nWARNING: Anyone with the Admin Link can edit or delete the event!!`;
		return lang === "de" ? de : en;
	},
	imageKept: (lang: BotLanguage) => {
		const de = `ℹ️ Du hast kein Bild angegeben, daher wurde das bestehende Bild beibehalten.`;
		const en = `ℹ️ You didn't provide an image, so the existing image was kept.`;
		return lang === "de" ? de : en;
	},
} as const;
