const WHATSAPP_JID = /\d[\d:-]*@(?:lid|s\.whatsapp\.net|g\.us|c\.us|broadcast|newsletter)\b/i;

/**
 * True when `value` is a username or display name we can show.
 * WhatsApp JIDs, bare phone numbers, and numeric ids are not.
 *
 * @example
 * isProperDisplayName(`Sam`)
 * isProperDisplayName(`47382582554768@lid`)
 */
export function isProperDisplayName(value: string | null | undefined): value is string {
	const name = value?.trim();
	if (!name) return false;
	if (WHATSAPP_JID.test(name)) return false;
	if (isBarePhoneOrNumericId(name)) return false;
	return true;
}

/**
 * Trimmed display name, or null when the value should not be stored or shown.
 *
 * @example
 * displayNameForStorage(`  Sam  `)
 * displayNameForStorage(`491701234567`)
 */
export function displayNameForStorage(value: string | null | undefined) {
	const name = value?.trim();
	if (!isProperDisplayName(name)) return null;
	return name;
}

function isBarePhoneOrNumericId(name: string) {
	const compact = name.replace(/[\s()+.\-/]/g, ``);
	if (!compact) return false;
	return /^\d+$/.test(compact);
}
