const WHATSAPP_JID = /^\d[\d:-]*@(?:lid|s\.whatsapp\.net|g\.us|c\.us)$/i;
const MIN_NUMERIC_ID_LENGTH = 8;

/**
 * True when `value` is a username or display name we can show.
 * WhatsApp JIDs, bare phone numbers, and long numeric ids are not.
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

function isBarePhoneOrNumericId(name: string) {
	const compact = name.replace(/[\s()+.\-/]/g, ``);
	return /^\d+$/.test(compact) && compact.length >= MIN_NUMERIC_ID_LENGTH;
}
