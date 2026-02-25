// Telegram bot messages translations
// Language is detected from ctx.from.language_code
// Defaults to English, only German ('de') gets special treatment

export type BotLanguage = 'en' | 'de';

export function detectLanguage(languageCode: string | undefined): BotLanguage {
	if (languageCode === 'de') return 'de';
	return 'en';
}

type MessageKey = 
	| 'eventExistsOnSource'
	| 'noEventData'
	| 'noEventName'
	| 'noStartDate'
	| 'noLocation'
	| 'noTelegramUsername'
	| 'notEventOwner'
	| 'saveError'
	| 'genericError'
	| 'eventUpdated'
	| 'eventCreated'
	| 'adminLinkWarning'
	| 'imageKept';

type MessageTemplate = string | ((...args: string[]) => string);

const messages: Record<MessageKey, Record<BotLanguage, MessageTemplate>> = {
	eventExistsOnSource: {
		en: (source: string) => `👯 It looks like this event already exists on ${source}.\nWe regularly add all events from ${source} to Blissbase, so you don't need to send them to us. 😉`,
		de: (source: string) => `👯 Es sieht aus als ob dieser Event bereits auf ${source} existiert.\nWir fügen regelmäßig alle Events von ${source} zu Blissbase hinzu. Du musst uns diese Events also nicht schicken. 😉`,
	},
	noEventData: {
		en: "🙅🏻‍♂️🎫 I couldn't extract any event data from this message. Please send me an event description or announcement.",
		de: "🙅🏻‍♂️🎫 Aus dieser Nachricht konnte ich keine Eventdaten extrahieren. Bitte schicke mir eine Event Beschreibung/Ankündigung.",
	},
	noEventName: {
		en: "🙅🏻‍♂️🪧 I couldn't extract a clear title for the event from this message.",
		de: "🙅🏻‍♂️🪧 Aus dieser Nachricht konnte ich keinen eindeutigen Titel für den Event extrahieren.",
	},
	noStartDate: {
		en: "🙅🏻‍♂️📅 I couldn't extract a start time for the event from this message.",
		de: "🙅🏻‍♂️📅 Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren.",
	},
	noLocation: {
		en: "🙅🏻‍♂️📍 I couldn't extract a location for the event from this message. Please always provide a location.",
		de: "🙅🏻‍♂️📍 Aus dieser Nachricht konnte ich keinen Ort für den Event extrahieren. Bitte gebe immer einen Ort an.",
	},
	noTelegramUsername: {
		en: "⚠️ In your message you ask participants to contact you via Telegram, but you haven't set a Telegram Username in your profile.\n\nPlease set a Telegram Username first so participants can reach you via Telegram link. Then you can send me the message again.",
		de: "⚠️ In deiner Nachricht forderst du Teilnehmer auf sich bei dir per Telegram zu melden, allerdings hast du in deinem Profil keinen Telegram Username eingetragen.\n\nBitte lege erst einen Telegram Username fest damit dich Teilnehmer per Telegram Link erreichen können. Danach kannst du mir die Nachricht erneut senden.",
	},
	notEventOwner: {
		en: "🙅🏻‍♂️🔐 This event already exists and you didn't create it. Therefore, you cannot edit it.",
		de: "🙅🏻‍♂️🔐 Dieser Event existiert schon und du hast ihn nicht erstellt. Deshalb kannst du ihn auch nicht bearbeiten.",
	},
	saveError: {
		en: "⚠️ Error saving the event. Please try again later.",
		de: "⚠️ Fehler beim Speichern des Events. Bitte versuche es später erneut.",
	},
	genericError: {
		en: (error: string) => `⚠️ The message could not be processed. Please try again later.\n\nError: ${error}`,
		de: (error: string) => `⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: ${error}`,
	},
	eventUpdated: {
		en: (url: string, skippedImageMsg: string, adminLinkText: string) => `✅ The event has been updated:\n<a href="${url}">Link to your event</a>\n${skippedImageMsg}\n\n${adminLinkText}`,
		de: (url: string, skippedImageMsg: string, adminLinkText: string) => `✅ Der Event wurde aktualisiert:\n<a href="${url}">Link zu deinem Event</a>\n${skippedImageMsg}\n\n${adminLinkText}`,
	},
	eventCreated: {
		en: (url: string, adminLinkText: string) => `✅ The event has been added to Blissbase. Share the link with your participants:\n<a href="${url}">Link to your event</a>\n\n${adminLinkText}`,
		de: (url: string, adminLinkText: string) => `✅ Der Event wurde in Blissbase eingetragen. Teile den Link mit deinen Teilnehmern:\n<a href="${url}">Link zu deinem Event</a>\n\n${adminLinkText}.`,
	},
	adminLinkWarning: {
		en: (url: string) => `⚠️ Link to edit the event:\n<a href="${url}">Admin Link (do not share)</a>\nWARNING: Anyone with the Admin Link can edit or delete the event!!`,
		de: (url: string) => `⚠️ Link zum bearbeiten des Events:\n<a href="${url}">Admin Link (nicht teilen)</a>\nACHTUNG: Jeder mit dem Admin Link kann den Event bearbeiten oder löschen!!`,
	},
	imageKept: {
		en: "ℹ️ You didn't provide an image, so the existing image was kept.",
		de: "ℹ️ Du hast kein Bild angegeben, daher wurde das bestehende Bild beibehalten.",
	},
};

export function t(key: MessageKey, lang: BotLanguage, ...args: string[]): string {
	const message = messages[key][lang];
	if (typeof message === 'function') {
		return message(...args);
	}
	return message;
}
