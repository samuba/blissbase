import { locales } from "./data.js";

/** Cookie wins when valid; otherwise de only for German browsers, else en. */
export function resolveLocale({ cookieLocale, browserLang }: { cookieLocale?: string | null; browserLang?: string | null }): "en" | "de" {
	if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
		return cookieLocale as "en" | "de";
	}
	return browserLang?.toLowerCase() === `de` ? `de` : `en`;
}
