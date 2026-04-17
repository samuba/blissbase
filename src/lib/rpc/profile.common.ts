import { PROFILE_SOCIAL_TYPES, type ProfileSocialType } from '$lib/socialLinks';
import * as v from 'valibot';



/**
 * Converts empty form strings into `undefined`.
 */
function emptyStringIsUndefined(schema: v.GenericSchema<string, string>) {
	return v.union([v.pipe(v.literal(``), v.transform(() => undefined)), schema]);
}

export const publicProfileFormSchema = v.pipe(v.object({
	displayName: v.pipe(v.string(), v.trim(), v.nonEmpty(`Name muss ausgefüllt werden`), v.maxLength(120, `Name ist zu lang`)),
	slug: v.optional(
		emptyStringIsUndefined(
			v.pipe(
				v.string(),
				v.trim(),
				v.maxLength(80, `Profil-URL ist zu lang`),
				v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, `Profil-URL darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten`)
			)
		)
	),
	bio: v.optional(v.pipe(v.string(), v.maxLength(100_000, `Bio ist zu lang`)), ``),
	profileImageUrl: v.optional(
		emptyStringIsUndefined(v.pipe(v.string(), v.trim(), v.url(`Profilbild-URL ist ungültig`))),
		``
	),
	bannerImageUrl: v.optional(
		emptyStringIsUndefined(v.pipe(v.string(), v.trim(), v.url(`Bannerbild-URL ist ungültig`))),
		``
	),
	socialLinks: v.pipe(v.optional(v.array(v.object({
		type: v.picklist(PROFILE_SOCIAL_TYPES, `Link-Typ ist ungültig`),
		value: v.pipe(v.string(), v.trim(), v.maxLength(1000, `Link ist zu lang`),
	)
	})), []),
		v.mapItems((link) => {
			if (link.type === `telegram`) {
				link.value = link.value.replace(`@`, ``);
			}
			return link
		}),
		v.checkItems((link) => {
			if (link.type === `email`) return !!link.value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
			return true;
		}, 'E-Mail Adresse ungültig'),
		v.checkItems((link) => {
			if (link.type === `phone`) return !!link.value.match(/^\+?[0-9]+$/);
			return true;
		}, 'Telefonnummer ungültig'),
		v.checkItems((link) => {
			if (link.type === `whatsapp`) return !!link.value.match(/^\+?[0-9]+$/);
			return true;
		}, 'WhatsApp Nummer ungültig'),
		v.checkItems((link) => {
			if (link.type === `telegram`) {
				const value = link.value
				if (value.length < 5 || value.length > 32 ) {
					return false;
				}
				// Only Latin letters, numbers and underscores, 5-32 chars
				// Cannot start with number or end with underscore or have consecutive underscores
				if (
					!/^[a-zA-Z_][a-zA-Z0-9_]{4,31}$/.test(value) || // correct length/charset, first char not a number
					/_$/.test(value) || // cannot end with underscore
					/__/.test(value) // cannot contain consecutive underscores
				) {
					return false;
				}
				return true;
			}
			return true;
		}, 'Telegram Benutzername ungültig'),
		v.checkItems((link) => {
			if (link.type === `youtube`) {
				const value = link.value.trim();
				// 3-30 chars, alphanum, _ - . ·, not starting or ending with special chars
				if (
					value.length < 3 ||
					value.length > 30 ||
					!/^[A-Za-z0-9._\-·]+$/.test(value) ||
					/^[._\-·]/.test(value) ||    // starts with special
					/[._\-·]$/.test(value)       // ends with special
				) {
					return false;
				}
				return true;
			}
			return true;
		}, 'YouTube Benutzername ungültig'),
		v.checkItems((link) => {
			if (link.type === `instagram`) {
				// Lowercase letters, numbers, . and _
				// Max 30 chars, no spaces, symbols, @, no consecutive . or _, can't start with .
				const value = link.value.trim();
				if (
					value.length === 0 ||
					value.length >= 30 ||
					!/^[a-z0-9._]+$/.test(value) ||
					/[\s@&+]/.test(value) || // forbidden chars
					/\.\.|__|_\./.test(value) || // consecutive . or _
					value[0] === '.' // can't start with .
				) {
					return false;
				}
				return true;
			}
			return true;
		}, 'Instagram Benutzername ungültig'),
		v.checkItems((link) => {
			if (link.type === `facebook`) {
				const value = link.value.trim();
				// Facebook usernames: at least 5 chars, alphanum and periods only
				if (
					value.length < 5 ||
					!/^[a-z0-9.]+$/i.test(value)
				) {
					return false;
				}
				return true;
			}
			return true;
		}, 'Facebook Benutzername ungültig'),
		v.checkItems((link) => {
			if (link.type === `tiktok`) {
				const value = link.value.trim();
				// TikTok usernames: max 24 chars, letters, numbers, _ and .
				if (
					value.length === 0 ||
					value.length > 24 ||
					!/^[A-Za-z0-9._]+$/.test(value)
				) {
					return false;
				}
				return true;
			}
			return true;
		}, 'TikTok Benutzername ungültig'),
		v.checkItems((link) => {
			if (link.type === `website`) {
				if (!link.value.startsWith("https://")) {
					link.value = "https://" + link.value
				} 
				try {
					const url = new URL(link.value)
					// Check if the hostname contains at least one dot for a TLD
					return !!url.hostname && url.hostname.includes(`.`)
				} catch {
					return false;
				}
			}
			return true;
		}, 'Website ist keine gültige URL')
	),
}));

/**
 * Converts stored social links into button-ready href entries.
 *
 * @example
 * getPublicProfileSocialEntries([{ type: `website`, value: `https://blissbase.app` }]);
 */
export function getPublicProfileSocialEntries(socialLinks: PublicProfileSocialLinks | null | undefined) {
	return (socialLinks ?? []).flatMap((link) => {
		const value = link.value?.trim();
		if (!value) return [];
		return [{ type: link.type, url: value }] as const;
	});
}

export type PublicProfileSocialLink = { type: ProfileSocialType; value: string };
export type PublicProfileSocialLinks = PublicProfileSocialLink[];
